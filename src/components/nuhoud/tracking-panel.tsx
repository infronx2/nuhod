'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Play, Square, Camera, ScanFace, RotateCcw, Save, Loader2, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { usePoseTracking, type PoseTrackingApi } from '@/hooks/use-pose-tracking'
import { useDemoSimulator, synthElbowAngleAt } from '@/hooks/use-demo-simulator'
import { AngleGauge } from '@/components/nuhoud/angle-gauge'
import { CommandBanner } from '@/components/nuhoud/command-banner'
import { MetricsGrid } from '@/components/nuhoud/metrics-grid'
import { ExercisePicker, type ExercisePickerValue } from '@/components/nuhoud/exercise-picker'
import { useAuth } from '@/hooks/use-auth'
import { apiFetch } from '@/lib/api'
import type { V2SaveSessionResponse } from '@/lib/v2-types'
import type { WsCommand, PoseLandmarks } from '@/components/nuhoud/types'

type Mode = 'live' | 'demo'

interface TrackingPanelProps {
  goal: number
  onGoalChange: (n: number) => void
  onTrackState?: (snap: TrackSnapshot) => void
  /**
   * The pose-tracking hook instance, owned by the page so that the
   * header connection pill, the JSON stream panel and this panel all
   * share a single WebSocket. Pass `usePoseTracking(...)` from the page.
   */
  pose: PoseTrackingApi
  /**
   * Optional callback invoked after a session is successfully persisted to
   * /api/v2/sessions. Parents can use this to refresh charts/history.
   * Receives the saved session's goal achievements (if any) so the parent
   * can fire a celebration.
   */
  onSessionSaved?: (goalAchievements?: Array<{ title: string; currentValue: number; targetValue: number }>) => void
}

export interface TrackSnapshot {
  mode: Mode
  running: boolean
  durationSeconds: number
  repCount: number
  correctReps: number
  maxAchievedAngle: number
  compensationErrors: number
  score: number
  simulated: boolean
}

const FRAME_RATE_TARGET = 10
const DEMO_FRAME_INTERVAL = 1000 / FRAME_RATE_TARGET

interface DemoMetrics {
  angle: number
  maxAngle: number
  reps: number
  correctReps: number
  score: number
  compensationErrors: number
  startedAt: number
  lastFlexedHigh: boolean
  lastFlexedLow: boolean
}

const DEMO_INITIAL: DemoMetrics = {
  angle: 0,
  maxAngle: 0,
  reps: 0,
  correctReps: 0,
  score: 0,
  compensationErrors: 0,
  startedAt: 0,
  lastFlexedHigh: false,
  lastFlexedLow: true,
}

/**
 * TrackingPanel — the headline feature of the dashboard.
 *
 * Left column: a canvas showing either the live webcam frame (with
 * skeleton overlay from server landmarks) OR the demo stick figure.
 * A control bar above lets the user switch mode, start/stop, change
 * limb, and tune target/threshold sliders — each sends a config
 * message over the WebSocket.
 *
 * Right column: live biomechanics readout (gauge + command banner +
 * metrics grid + progress).
 *
 * In demo mode the metrics are computed client-side because MediaPipe
 * will return NO_POSE for the synthetic stick figure. This keeps the
 * dashboard demonstrable without a webcam (e.g. agent-browser).
 */
export function TrackingPanel({ goal, onGoalChange, onTrackState, pose, onSessionSaved }: TrackingPanelProps) {
  const { user } = useAuth()
  const t = useTranslations('tracking')
  const [mode, setMode] = React.useState<Mode>('demo')
  const [showSettings, setShowSettings] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [limb, setLimb] = React.useState<'right' | 'left'>('right')
  const [targetAngle, setTargetAngle] = React.useState(90)
  const [compensationThreshold, setCompensationThreshold] = React.useState(0.05)
  const [mirror, setMirror] = React.useState(true)
  const [cameraError, setCameraError] = React.useState<string | null>(null)
  const [demoMetrics, setDemoMetrics] = React.useState<DemoMetrics>(DEMO_INITIAL)
  const [exercise, setExercise] = React.useState<ExercisePickerValue>({
    slug: 'custom',
    targetAngle: 90,
    limb: 'right',
    description: null,
    difficulty: null,
  })
  const [savingSession, setSavingSession] = React.useState(false)

  // Rolling buffer of elbow-angle samples for the session's angleTimeline
  // field (POSTed to /api/v2/sessions on save). Capped at 500 to match the
  // server-side clamp.
  const angleTimelineRef = React.useRef<number[]>([])

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const lastFrameTsRef = React.useRef(0)
  const streamRef = React.useRef<MediaStream | null>(null)
  const demoStartRef = React.useRef(0)

  // When the exercise preset changes, sync its target angle + limb into
  // the local control state (this fires sendConfig via the effect below).
  // 'custom' leaves the slider value alone.
  React.useEffect(() => {
    if (exercise.slug === 'custom') return
    setTargetAngle(exercise.targetAngle)
    setLimb(exercise.limb)
  }, [exercise.slug, exercise.targetAngle, exercise.limb])

  // Keep the shared hook config in sync with the local control state so
  // sendConfig / start always use the latest values.
  //
  // We destructure `sendConfig` out of `pose` and depend on THAT rather than
  // the whole `pose` object: the hook returns a fresh object literal every
  // render, so depending on `pose` would re-fire this effect on every render
  // → sendConfig → setAppliedConfig → re-render → infinite loop ("Maximum
  // update depth exceeded"). `sendConfig` is a `useCallback` with [] deps so
  // its identity is stable across renders.
  const { sendConfig } = pose
  React.useEffect(() => {
    sendConfig({
      limb,
      target_angle: targetAngle,
      compensation_threshold: compensationThreshold,
    })
  }, [limb, targetAngle, compensationThreshold, sendConfig])

  const sim = useDemoSimulator()

  // ---- Frame loop (single rAF, shared by both modes) ----
  // We use a ref indirection so the callback can reschedule itself
  // without referencing its own (TDZ-bound) `const` name.
  const loopRef = React.useRef<() => void>(() => {})
  const drawAndSend = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      rafRef.current = requestAnimationFrame(() => loopRef.current())
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      rafRef.current = requestAnimationFrame(() => loopRef.current())
      return
    }
    const now = performance.now()
    const elapsed = now - lastFrameTsRef.current
    if (elapsed < DEMO_FRAME_INTERVAL) {
      rafRef.current = requestAnimationFrame(() => loopRef.current())
      return
    }
    lastFrameTsRef.current = now

    // Push the current displayed angle into the rolling timeline buffer
    // (capped at 500 samples). Only happens during active tracking.
    const angleNow = mode === 'demo' ? demoMetrics.angle : pose.elbowAngle
    if (typeof angleNow === 'number' && angleNow > 0) {
      const buf = angleTimelineRef.current
      buf.push(Math.round(angleNow * 100) / 100)
      if (buf.length > 500) buf.splice(0, buf.length - 500)
    }

    if (mode === 'live') {
      const video = videoRef.current
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(() => loopRef.current())
        return
      }
      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 480
      if (canvas.width !== vw) canvas.width = vw
      if (canvas.height !== vh) canvas.height = vh
      ctx.save()
      if (mirror) {
        ctx.translate(vw, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(video, 0, 0, vw, vh)
      ctx.restore()

      // Send base64 frame to backend (strip data URI prefix).
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
      const b64 = dataUrl.split(',')[1] ?? ''
      pose.sendFrame(b64)

      drawSkeleton(ctx, pose.landmarks, vw, vh, pose.command, mirror)
    } else {
      // Demo mode — capture from the offscreen simulator canvas, send it
      // to the backend, and draw it directly onto our visible canvas
      // (no async base64→Image round-trip needed).
      const simDataUrl = sim.captureFrame()
      const b64 = simDataUrl.split(',')[1] ?? ''
      pose.sendFrame(b64)

      if (sim.canvas) {
        if (canvas.width !== sim.canvas.width) canvas.width = sim.canvas.width
        if (canvas.height !== sim.canvas.height) canvas.height = sim.canvas.height
        ctx.drawImage(sim.canvas, 0, 0)
      }
    }

    rafRef.current = requestAnimationFrame(() => loopRef.current())
  }, [mode, mirror, pose, sim, demoMetrics.angle])

  // ---- Live camera start/stop ----
  const startCamera = React.useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Switch to Demo Simulator to try the dashboard without a webcam.'
          : err instanceof Error
            ? err.message
            : 'Unknown camera error'
      setCameraError(msg)
      toast.error('Camera access failed', { description: msg })
      setMode('demo')
      setRunning(false)
    }
  }, [])

  const stopCamera = React.useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) video.srcObject = null
  }, [])

  // ---- Start / Stop tracking ----
  const startTracking = React.useCallback(() => {
    pose.start()
    sim.reset()
    demoStartRef.current = performance.now()
    setDemoMetrics({
      ...DEMO_INITIAL,
      startedAt: performance.now(),
      lastFlexedLow: true,
    })
    setRunning(true)
    if (mode === 'live') {
      void startCamera()
    }
  }, [mode, pose, sim, startCamera])

  const stopTracking = React.useCallback(() => {
    setRunning(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    pose.stop()
    stopCamera()
  }, [pose, stopCamera])

  // Keep the loop ref pointing at the latest drawAndSend so the rAF
  // self-rescheduler always invokes a fresh closure with up-to-date
  // `mode`, `mirror`, `pose`, and `sim` values.
  React.useEffect(() => {
    loopRef.current = drawAndSend
  }, [drawAndSend])

  // Manage the rAF loop based on running state.
  React.useEffect(() => {
    if (running) {
      lastFrameTsRef.current = 0
      rafRef.current = requestAnimationFrame(() => loopRef.current())
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [running])

  // Clean up camera on unmount or mode change away from live.
  React.useEffect(() => {
    if (mode !== 'live' || !running) {
      stopCamera()
    }
    return () => stopCamera()
  }, [mode, running, stopCamera])

  // Reset the angle timeline buffer when (re)starting a tracking session.
  React.useEffect(() => {
    if (running) angleTimelineRef.current = []
  }, [running])

  // ---- Demo mode client-side metrics (rep counter with hysteresis) ----
  React.useEffect(() => {
    if (!running || mode !== 'demo') return
    let raf = 0
    const tick = () => {
      const t = performance.now() - demoStartRef.current
      const angle = synthElbowAngleAt(t)
      const flexedHigh = angle >= targetAngle * 0.9
      const flexedLow = angle <= targetAngle * 0.4
      // Simulate an occasional compensation error (every ~6s during the
      // "upswing") so the Comp. Errors metric in demo mode is non-zero.
      const compPhase = (t / 1000) % 6
      const compensationNow = compPhase > 4.5 && compPhase < 5.0

      setDemoMetrics((prev) => {
        let reps = prev.reps
        let correctReps = prev.correctReps
        let score = prev.score
        let compensationErrors = prev.compensationErrors
        let lastFlexedHigh = prev.lastFlexedHigh
        let lastFlexedLow = prev.lastFlexedLow
        const maxAngle = Math.max(prev.maxAngle, angle)

        // Hysteresis rep counter: a rep is one cycle (low → high → low).
        if (flexedHigh && !lastFlexedHigh && lastFlexedLow) {
          reps += 1
          if (compensationNow) {
            compensationErrors += 1
            score += 3
          } else {
            correctReps += 1
            score += 10
          }
        }
        if (flexedHigh) lastFlexedLow = false
        if (flexedLow) {
          lastFlexedHigh = false
          lastFlexedLow = true
        }
        if (flexedHigh) lastFlexedHigh = true

        return {
          angle,
          maxAngle,
          reps,
          correctReps,
          score,
          compensationErrors,
          startedAt: prev.startedAt,
          lastFlexedHigh,
          lastFlexedLow,
        }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, mode, targetAngle])

  // ---- Push snapshot upstream for session saving ----
  const liveAngle = pose.elbowAngle
  const demoAngle = demoMetrics.angle
  const displayedAngle = mode === 'demo' ? demoAngle : liveAngle
  const displayedMax = mode === 'demo' ? demoMetrics.maxAngle : pose.maxAchievedAngle
  const displayedReps = mode === 'demo' ? demoMetrics.reps : pose.repCount
  const displayedScore = mode === 'demo' ? demoMetrics.score : pose.score
  const displayedCompErrors =
    mode === 'demo' ? demoMetrics.compensationErrors : pose.compensationErrors
  const displayedCorrectReps =
    mode === 'demo'
      ? demoMetrics.correctReps
      : Math.max(0, pose.repCount - pose.compensationErrors)
  const displayedLatency = pose.latencyMs || 0
  const displayedFps = pose.fpsAvg || (running ? FRAME_RATE_TARGET : 0)
  const displayedTargetReached =
    mode === 'demo' ? demoAngle >= targetAngle : pose.targetReached
  const displayedCompensation = mode === 'demo' ? false : pose.compensationDetected
  const displayedCommand: WsCommand =
    mode === 'demo'
      ? displayedTargetReached
        ? 'TARGET_HIT'
        : 'KEEP_GOING'
      : pose.command

  React.useEffect(() => {
    if (!onTrackState) return
    onTrackState({
      mode,
      running,
      durationSeconds: demoStartRef.current
        ? (performance.now() - demoStartRef.current) / 1000
        : 0,
      repCount: displayedReps,
      correctReps: displayedCorrectReps,
      maxAchievedAngle: displayedMax,
      compensationErrors: displayedCompErrors,
      score: displayedScore,
      simulated: mode === 'demo',
    })
  }, [
    onTrackState,
    mode,
    running,
    displayedReps,
    displayedCorrectReps,
    displayedMax,
    displayedCompErrors,
    displayedScore,
  ])

  // ---- Save session to /api/v2/sessions ----
  const handleSaveSession = React.useCallback(async () => {
    if (!user) {
      toast.error('Sign in to save sessions', {
        description: 'You must be authenticated to persist a session.',
      })
      return
    }
    if (displayedReps <= 0) {
      toast.warning('No reps to save', {
        description: 'Start tracking and complete at least one rep first.',
      })
      return
    }
    setSavingSession(true)
    try {
      const payload = {
        patientId: user.id,
        source: mode,
        limb,
        durationSeconds: Math.max(
          1,
          Math.round(
            demoStartRef.current
              ? (performance.now() - demoStartRef.current) / 1000
              : 0,
          ),
        ),
        totalReps: displayedReps,
        correctReps: displayedCorrectReps,
        maxAchievedAngle: Math.round(displayedMax * 100) / 100,
        compensationErrors: displayedCompErrors,
        gamificationScore: displayedScore,
        angleTimeline: angleTimelineRef.current.slice(-200),
      }
      const data = await apiFetch<V2SaveSessionResponse>('/api/v2/sessions', {
        method: 'POST',
        json: payload,
      })
      toast.success('Session saved', {
        description: `${payload.totalReps} reps · ${payload.gamificationScore} pts`,
      })
      // Clear the buffer so the next session starts fresh.
      angleTimelineRef.current = []
      // Pass goal achievements up so the parent can fire a celebration.
      const goalAchievements = (data as any).goalAchievements as
        | Array<{ title: string; currentValue: number; targetValue: number }>
        | undefined
      onSessionSaved?.(goalAchievements)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      toast.error('Save failed', { description: msg })
    } finally {
      setSavingSession(false)
    }
  }, [
    user,
    mode,
    limb,
    displayedReps,
    displayedCorrectReps,
    displayedMax,
    displayedCompErrors,
    displayedScore,
    onSessionSaved,
  ])

  return (
    <Card className="overflow-hidden border-border/50 bg-card/50 shadow-sm">
      <div className="grid grid-cols-1 gap-6 p-5 sm:p-8 lg:grid-cols-2 lg:gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-border bg-card">
              <button
                onClick={() => {
                  if (running) stopTracking()
                  setMode('live')
                }}
                className={cn(
                  'flex h-10 items-center gap-1.5 px-3.5 text-sm font-medium transition-colors',
                  mode === 'live'
                    ? 'bg-primary text-primary'
                    : 'text-foreground/80 hover:bg-muted',
                )}
                aria-pressed={mode === 'live'}
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                {t('liveCamera')}
              </button>
              <button
                onClick={() => {
                  if (running) stopTracking()
                  setMode('demo')
                }}
                className={cn(
                  'flex h-10 items-center gap-1.5 px-3.5 text-sm font-medium transition-colors',
                  mode === 'demo'
                    ? 'bg-primary text-primary'
                    : 'text-foreground/80 hover:bg-muted',
                )}
                aria-pressed={mode === 'demo'}
              >
                <ScanFace className="h-4 w-4" aria-hidden="true" />
                {t('demoSimulator')}
              </button>
            </div>

            <Button
              size="lg"
              className={cn(
                'h-11 min-w-[11rem] gap-2 px-5 text-sm font-semibold shadow-sm',
                running
                  ? 'bg-rose-500 text-rose-50 hover:bg-rose-600'
                  : 'bg-emerald-500 text-emerald-50 hover:bg-emerald-600',
              )}
              onClick={running ? stopTracking : startTracking}
              aria-label={running ? t('stopTracking') : t('startTracking')}
            >
              {running ? (
                <>
                  <Square className="h-4 w-4" aria-hidden="true" />
                  {t('stopTracking')}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {t('startTracking')}
                </>
              )}
            </Button>

            <Select
              value={limb ?? ''}
              onValueChange={(v) => {
                setLimb(v as 'right' | 'left')
                pose.sendConfig({ limb: v as 'right' | 'left' })
              }}
            >
              <SelectTrigger className="h-10 w-[130px] text-sm" aria-label={t('limbSelection')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="right">{t('rightArm')}</SelectItem>
                <SelectItem value="left">{t('leftArm')}</SelectItem>
              </SelectContent>
            </Select>

            {mode === 'live' && (
              <Button
                size="sm"
                variant="outline"
                className="h-10 gap-1.5"
                onClick={() => setMirror((m) => !m)}
                aria-label={t('mirror')}
                aria-pressed={mirror}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('mirror')}
              </Button>
            )}
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border/50 bg-slate-950">
            <video
              ref={videoRef}
              playsInline
              muted
              className="hidden h-full w-full object-cover"
              aria-hidden="true"
            />
            <canvas
              ref={canvasRef}
              className="h-full w-full object-contain"
              role="img"
              aria-label={
                mode === 'live'
                  ? 'Live camera feed with pose skeleton overlay'
                  : 'Demo simulator stick figure'
              }
            />
            <div className="pointer-events-none absolute start-3 top-3">
              <Badge
                className={cn(
                  'w-fit text-[10px] font-semibold uppercase tracking-wider',
                  running
                    ? 'bg-emerald-500 text-emerald-50'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {running ? t('recording') : t('idle')}
              </Badge>
            </div>
            {!running && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/70 px-6 text-center text-slate-200">
                <ScanFace className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
                <p className="text-base font-medium">
                  {mode === 'live' ? t('cameraIdle') : t('simulatorIdle')}
                </p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {t('pressStart')}
                </p>
              </div>
            )}
            {mode === 'live' && cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/85 p-6 text-center text-rose-300">
                <p className="text-sm font-medium">{t('cameraDenied')}</p>
                <p className="text-xs text-rose-300/80">{cameraError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    setMode('demo')
                    setCameraError(null)
                  }}
                >
                  {t('switchToDemo')}
                </Button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="inline-flex items-center gap-2 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showSettings}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t('sessionSettings')}
          </button>
          {showSettings && (
            <div className="flex flex-col gap-4 rounded-xl border border-border/40 bg-muted/20 p-4">
              <ExercisePicker value={exercise} onChange={setExercise} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="target-angle" className="font-medium text-muted-foreground">
                      {t('targetAngle')}
                    </label>
                    <span className="font-mono font-semibold text-primary">
                      {targetAngle}°
                    </span>
                  </div>
                  <Slider
                    id="target-angle"
                    value={[targetAngle]}
                    min={0}
                    max={180}
                    step={1}
                    onValueChange={(v) => setTargetAngle(v[0])}
                    onValueCommit={(v) => pose.sendConfig({ target_angle: v[0] })}
                    aria-label={t('targetAngle')}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="comp-thr" className="font-medium text-muted-foreground">
                      {t('compensationThreshold')}
                    </label>
                    <span className="font-mono font-semibold text-rose-500">
                      {compensationThreshold.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    id="comp-thr"
                    value={[compensationThreshold]}
                    min={0.01}
                    max={0.2}
                    step={0.01}
                    onValueChange={(v) => setCompensationThreshold(v[0])}
                    onValueCommit={(v) =>
                      pose.sendConfig({ compensation_threshold: v[0] })
                    }
                    aria-label={t('compensationThreshold')}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <motion.div
            layout
            className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card p-4"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('elbowAngle')}
              </span>
              <span className="text-xs text-muted-foreground/80">
                {mode === 'demo' ? t('demoMode') : t('liveMode')}
              </span>
            </div>
            <AngleGauge
              angle={displayedAngle}
              target={targetAngle}
              compensation={displayedCompensation}
              reached={displayedTargetReached}
              simulated={mode === 'demo'}
            />
          </motion.div>

          <CommandBanner command={displayedCommand} />

          <MetricsGrid
            repCount={displayedReps}
            score={displayedScore}
            maxAngle={displayedMax}
            compensationErrors={displayedCompErrors}
            latencyMs={displayedLatency}
            fpsAvg={displayedFps}
            latencyHistory={pose.latencyHistory}
            angleHistory={mode === 'demo' ? [] : pose.angleHistory}
            fpsHistory={pose.fpsHistory}
            goal={goal}
            onGoalChange={onGoalChange}
            simulated={mode === 'demo'}
            command={displayedCommand}
          />

          {user && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-muted/20 p-4">
              <Button
                size="sm"
                className="h-10 gap-1.5 bg-primary px-4 text-white hover:bg-primary"
                onClick={handleSaveSession}
                disabled={savingSession || displayedReps <= 0}
              >
                {savingSession ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {savingSession ? t('saving') : t('saveSession')}
              </Button>
              <span className="ms-auto text-xs text-muted-foreground">
                {displayedReps > 0
                  ? t('saveHint', {
                      reps: displayedReps,
                      score: displayedScore,
                      max: displayedMax.toFixed(0),
                    })
                  : t('noRepsToSave')}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
const SKELETON_COLORS: Record<WsCommand, string> = {
  KEEP_GOING: '#0B5394',
  HOLD: '#f59e0b',
  TARGET_HIT: '#10b981',
  CORRECT_POSTURE: '#f43f5e',
  NO_POSE: '#94a3b8',
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: PoseLandmarks | null,
  w: number,
  h: number,
  command: WsCommand,
  mirror: boolean,
) {
  if (!landmarks) return
  const { shoulder, elbow, wrist } = landmarks
  if (!shoulder || !elbow || !wrist) return
  const color = SKELETON_COLORS[command]
  ctx.save()
  ctx.lineWidth = 5
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  // Mirror X coordinates if the displayed video was mirrored (selfie view).
  const mx = (x: number) => (mirror ? 1 - x : x) * w
  const my = (y: number) => y * h
  ctx.beginPath()
  ctx.moveTo(mx(shoulder[0]), my(shoulder[1]))
  ctx.lineTo(mx(elbow[0]), my(elbow[1]))
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(mx(elbow[0]), my(elbow[1]))
  ctx.lineTo(mx(wrist[0]), my(wrist[1]))
  ctx.stroke()
  ctx.fillStyle = color
  for (const [x, y] of [shoulder, elbow, wrist]) {
    ctx.beginPath()
    ctx.arc(mx(x), my(y), 7, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
