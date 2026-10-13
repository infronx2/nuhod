'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Play, Pause, RotateCcw, Activity, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SessionReplayProps {
  /** JSON-encoded array of elbow angles (one per frame, ~10fps). */
  angleTimelineJson: string | null
  /** The session's target angle for the reference line. */
  targetAngle?: number
  /** The session's max achieved angle (for the badge). */
  maxAngle?: number
  /** The session's duration in seconds (for the time axis). */
  durationSeconds?: number
}

/**
 * SessionReplay — scrubbable timeline of a completed session's elbow-angle
 * samples. The `angleTimeline` is stored per session as a JSON array of
 * floats (one sample per frame at ~10 fps). This component decodes it,
 * renders a recharts line chart, and plays it back with a play/pause
 * scrubber that highlights the "current" frame.
 *
 * Clinical use: a therapist can replay a past session to spot compensation
 * patterns (sudden shoulder shrugs show as angle spikes) or to show the
 * patient their progress over time.
 */
export function SessionReplay({
  angleTimelineJson,
  targetAngle = 90,
  maxAngle,
  durationSeconds,
}: SessionReplayProps) {
  const samples = React.useMemo<number[]>(() => {
    if (!angleTimelineJson) return []
    try {
      const parsed = JSON.parse(angleTimelineJson)
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : []
    } catch {
      return []
    }
  }, [angleTimelineJson])

  const chartData = React.useMemo(
    () =>
      samples.map((angle, i) => ({
        t: i,
        angle: Math.round(angle * 10) / 10,
      })),
    [samples],
  )

  const [playing, setPlaying] = React.useState(false)
  const [cursor, setCursor] = React.useState(0)
  const rafRef = React.useRef<number | null>(null)
  const lastTsRef = React.useRef(0)

  // Playback loop — advances ~10 frames per second to match the recording.
  React.useEffect(() => {
    if (!playing || samples.length === 0) return
    lastTsRef.current = 0
    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      if (dt >= 100) {
        // ~10 fps playback
        lastTsRef.current = ts
        setCursor((c) => {
          if (c >= samples.length - 1) {
            setPlaying(false)
            return samples.length - 1
          }
          return c + 1
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, samples.length])

  const restart = React.useCallback(() => {
    setCursor(0)
    setPlaying(true)
  }, [])

  const currentAngle = samples[cursor] ?? null
  const reachedTarget = currentAngle !== null && currentAngle <= targetAngle

  if (samples.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Activity className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No angle timeline recorded for this session.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Newer sessions store per-frame angles for playback.
        </p>
      </div>
    )
  }

  const elapsedSec = (cursor / 10).toFixed(1)
  const totalSec = (samples.length / 10).toFixed(1)

  return (
    <div className="flex flex-col gap-3">
      {/* Current-frame readout */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'font-mono text-sm',
              reachedTarget
                ? 'bg-emerald-500/20 text-emerald-500'
                : 'bg-primary/20 text-primary',
            )}
          >
            {currentAngle !== null ? `${currentAngle.toFixed(1)}°` : '—'}
          </Badge>
          <span className="text-xs text-muted-foreground">
            frame {cursor} of {samples.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="font-mono">
            {elapsedSec}s / {totalSec}s
          </span>
        </div>
      </div>

      {/* The chart */}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/30" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: 'currentColor' }}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(v) => `${(Number(v) / 10).toFixed(0)}s`}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 180]}
              ticks={[0, 45, 90, 135, 180]}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              stroke="currentColor"
              className="text-muted-foreground"
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v) => `frame ${v} (${(Number(v) / 10).toFixed(1)}s)`}
              formatter={(v: number) => [`${v.toFixed(1)}°`, 'elbow angle']}
            />
            <ReferenceLine
              y={targetAngle}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: `target ${targetAngle}°`,
                fontSize: 10,
                fill: '#f59e0b',
                position: 'insideTopRight',
              }}
            />
            <Line
              type="monotone"
              dataKey="angle"
              stroke="#0B5394"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: '#0B5394' }}
              isAnimationActive={false}
            />
            {/* Cursor marker — a vertical line at the current frame. */}
            <ReferenceLine
              x={cursor}
              stroke="#f43f5e"
              strokeWidth={2}
              label={{
                value: '▶',
                fontSize: 12,
                fill: '#f43f5e',
                position: 'top',
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => setPlaying((p) => !p)}
          disabled={cursor >= samples.length - 1 && !playing}
        >
          {playing ? (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" /> Play
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          onClick={restart}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restart
        </Button>
      </div>

      {/* Range scrubber */}
      <input
        type="range"
        min={0}
        max={samples.length - 1}
        value={cursor}
        onChange={(e) => {
          setPlaying(false)
          setCursor(Number(e.target.value))
        }}
        className="w-full accent-primary"
        aria-label="Session timeline scrubber"
      />
    </div>
  )
}

/**
 * SessionReplaySkeleton — loading state.
 */
export function SessionReplaySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-16" />
      </div>
      <Skeleton className="h-48 w-full" />
      <div className="flex justify-center gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="h-6 w-full" />
    </div>
  )
}
