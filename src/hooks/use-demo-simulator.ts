'use client'

import * as React from 'react'

const CANVAS_W = 320
const CANVAS_H = 240
const SHOULDER = { x: 160, y: 80 } as const
const ELBOW = { x: 160, y: 140 } as const
const FOREARM_LEN = 70

/**
 * Compute the live elbow angle (in degrees, 0..180) for the synthetic
 * stick figure at a given time `t` (ms). Smooth sinusoidal flexion cycle
 * between MIN_ANGLE and MAX_ANGLE with the given period.
 *
 * The wrist is placed along an arc so that:
 *   - At angle ~180° the forearm is fully extended downward (forearm
 *     aligned with the upper arm, both pointing down).
 *   - At angle ~20° the forearm is flexed up toward the shoulder.
 *
 * Math: elbowAngle = atan2 of the angle between (wrist−elbow) and
 * (shoulder−elbow), folded to [0,180].
 */
export function synthElbowAngleAt(t: number, periodMs = 4000): number {
  const min = 20
  const max = 160
  const phase = (t % periodMs) / periodMs
  const norm = (Math.sin(2 * Math.PI * phase - Math.PI / 2) + 1) / 2 // 0..1 smooth
  return min + (max - min) * norm
}

/**
 * Compute the wrist position (in canvas pixel coords) given the elbow
 * angle. The forearm rotates around the elbow; 0° = forearm pointing
 * straight up toward the shoulder, 180° = forearm pointing straight
 * down (extended).
 */
export function synthWristAt(elbowAngleDeg: number): { x: number; y: number } {
  const rad = (elbowAngleDeg * Math.PI) / 180
  // The upper arm points downward (shoulder above elbow). When the
  // elbow angle is 180°, the forearm should also point downward
  // (collinear, fully extended). When the angle is 0°, the forearm
  // points upward (fully flexed, wrist near shoulder).
  //
  // The "external" angle from the +Y axis (downward) is (180 - elbowAngle).
  // Place the forearm along that direction.
  const external = Math.PI - rad // angle from downward (+Y) axis
  const dx = Math.sin(external) * FOREARM_LEN
  const dy = Math.cos(external) * FOREARM_LEN
  return { x: ELBOW.x + dx, y: ELBOW.y + dy }
}

export interface DemoSimulatorApi {
  /** Render a synthetic frame and return its JPEG data URL. */
  captureFrame: () => string
  /** Reset internal timestamp (so the cycle restarts on next start). */
  reset: () => void
  /** Latest computed (client-side) elbow angle, in degrees. */
  currentAngle: number
  /** The offscreen simulator canvas — callers can drawImage directly. */
  canvas: HTMLCanvasElement | null
}

/**
 * useDemoSimulator — owns an offscreen canvas + drawing routine that
 * renders a stick figure whose elbow flexes smoothly between ~20° and
 * ~160°. Provides:
 *   - `captureFrame()` returns a JPEG data URL of the current frame.
 *   - `currentAngle` exposes the client-computed angle for the
 *     dashboard's gauge (the backend will return NO_POSE for the
 *     drawing; this keeps the UI demonstrable in agent-browser).
 *
 * The canvas is hidden from the DOM and never attached.
 */
export function useDemoSimulator(): DemoSimulatorApi {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const startRef = React.useRef<number>(0)
  const [currentAngle, setCurrentAngle] = React.useState(90)

  const [canvasEl, setCanvasEl] = React.useState<HTMLCanvasElement | null>(null)

  // Lazily allocate the offscreen canvas and surface it via state so
  // callers can drawImage directly without round-tripping through a
  // base64 data URL.
  const getCanvas = React.useCallback((): HTMLCanvasElement => {
    if (canvasRef.current) return canvasRef.current
    if (typeof document === 'undefined') {
      // SSR guard — should never hit at runtime (hook is 'use client').
      throw new Error('useDemoSimulator requires a DOM environment')
    }
    const c = document.createElement('canvas')
    c.width = CANVAS_W
    c.height = CANVAS_H
    canvasRef.current = c
    setCanvasEl(c)
    return c
  }, [])

  const reset = React.useCallback(() => {
    startRef.current = 0
  }, [])

  const drawStickFigure = React.useCallback(
    (
      ctx: CanvasRenderingContext2D,
      angleDeg: number,
      t: number,
    ) => {
      // Background — clinical dark gradient.
      const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
      grad.addColorStop(0, '#0f172a')
      grad.addColorStop(1, '#020617')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Subtle floor grid.
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)'
      ctx.lineWidth = 1
      for (let x = 0; x <= CANVAS_W; x += 32) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, CANVAS_H)
        ctx.stroke()
      }
      for (let y = 0; y <= CANVAS_H; y += 32) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(CANVAS_W, y)
        ctx.stroke()
      }

      // Head.
      ctx.fillStyle = '#5eead4'
      ctx.beginPath()
      ctx.arc(SHOULDER.x, SHOULDER.y - 38, 14, 0, Math.PI * 2)
      ctx.fill()

      // Torso.
      ctx.strokeStyle = '#5eead4'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(SHOULDER.x, SHOULDER.y - 24)
      ctx.lineTo(SHOULDER.x, SHOULDER.y + 80)
      ctx.stroke()

      // Hip line.
      ctx.beginPath()
      ctx.moveTo(SHOULDER.x - 30, SHOULDER.y + 80)
      ctx.lineTo(SHOULDER.x + 30, SHOULDER.y + 80)
      ctx.stroke()

      // Upper arm (shoulder -> elbow).
      ctx.strokeStyle = '#2dd4bf'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(SHOULDER.x, SHOULDER.y)
      ctx.lineTo(ELBOW.x, ELBOW.y)
      ctx.stroke()

      // Forearm (elbow -> wrist).
      const wrist = synthWristAt(angleDeg)
      ctx.beginPath()
      ctx.moveTo(ELBOW.x, ELBOW.y)
      ctx.lineTo(wrist.x, wrist.y)
      ctx.stroke()

      // Joint dots.
      const drawJoint = (x: number, y: number, color: string) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, 6, 0, Math.PI * 2)
        ctx.fill()
      }
      drawJoint(SHOULDER.x, SHOULDER.y, '#34d399')
      drawJoint(ELBOW.x, ELBOW.y, '#fbbf24')
      drawJoint(wrist.x, wrist.y, '#f472b6')

      // Angle arc at the elbow (visual cue for clinicians).
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)'
      ctx.lineWidth = 2
      ctx.beginPath()
      // arc from the upper-arm direction to the forearm direction
      const upperArmAngle = Math.atan2(SHOULDER.y - ELBOW.y, SHOULDER.x - ELBOW.x)
      const foreArmAngle = Math.atan2(wrist.y - ELBOW.y, wrist.x - ELBOW.x)
      ctx.arc(ELBOW.x, ELBOW.y, 22, upperArmAngle, foreArmAngle, false)
      ctx.stroke()

      // Text overlay: live angle (so the frame itself is informative).
      ctx.fillStyle = 'rgba(226, 232, 240, 0.9)'
      ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillText(`θ = ${angleDeg.toFixed(1)}°`, 12, 22)
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillStyle = 'rgba(148, 163, 184, 0.8)'
      ctx.fillText('Nuhoud · DEMO SIMULATOR', 12, 38)
      ctx.fillText(`t = ${(t / 1000).toFixed(2)}s`, 12, 52)
    },
    [],
  )

  const captureFrame = React.useCallback((): string => {
    const canvas = getCanvas()
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    if (startRef.current === 0) startRef.current = performance.now()
    const t = performance.now() - startRef.current
    const angle = synthElbowAngleAt(t)
    setCurrentAngle(angle)
    drawStickFigure(ctx, angle, t)
    return canvas.toDataURL('image/jpeg', 0.5)
  }, [drawStickFigure, getCanvas])

  return {
    captureFrame,
    reset,
    currentAngle,
    canvas: canvasEl,
  }
}
