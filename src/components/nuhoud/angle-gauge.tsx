'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface AngleGaugeProps {
  /** Current elbow angle in degrees (0..180). `null` for NO_POSE. */
  angle: number | null
  /** Target angle in degrees (0..180). */
  target: number
  /** Whether compensation was detected on this frame. */
  compensation: boolean
  /** Whether the target was reached. */
  reached: boolean
  /** True when the displayed metrics are simulated (demo mode). */
  simulated?: boolean
}

// SVG arc geometry — semi-circular gauge spanning 180° from left (0°) to right (180°).
const SIZE = 240
const STROKE = 18
const R = (SIZE - STROKE) / 2 - 6
const CX = SIZE / 2
const CY = SIZE / 2
// We render the arc starting at the LEFT (angle 0°) and sweeping to the RIGHT (angle 180°).
// Polar coordinates: 0° → (CX - R, CY), 180° → (CX + R, CY).
// angle 0..180 maps to polar 180°..0° (i.e. we measure from the left around the top to the right).
//
// We round every coordinate to 2 decimals on purpose: Math.cos/Math.sin produce
// floats with ~15 significant digits whose last few bits differ between Node
// (SSR) and the browser V8/WebKit builds. Without rounding React detects a
// hydration mismatch on the SVG x1/y1/x2/y2 attributes and throws a
// client-side exception. 2-decimal rounding is visually invisible (<0.01px)
// and makes server/client output byte-identical.
function polar(angleDeg: number, radius: number): { x: number; y: number } {
  // Map gauge angle (0..180) to SVG polar angle (180..0 going CCW over the top).
  const svgAngle = Math.PI - (angleDeg * Math.PI) / 180
  return {
    x: Math.round((CX + radius * Math.cos(svgAngle)) * 100) / 100,
    y: Math.round((CY - radius * Math.sin(svgAngle)) * 100) / 100,
  }
}

function arcPath(startDeg: number, endDeg: number, radius: number): string {
  const a = polar(startDeg, radius)
  const b = polar(endDeg, radius)
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  // For our gauge (0° at left, sweeping over the top to 180° at right),
  // the SVG sweep direction is clockwise (sweep-flag = 1) because SVG
  // y is flipped (y-down). This draws the short arc above the chord.
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x} ${b.y}`
}

export function AngleGauge({
  angle,
  target,
  compensation,
  reached,
  simulated = false,
}: AngleGaugeProps) {
  const displayAngle = angle ?? 0
  const hasPose = angle !== null && Number.isFinite(angle)
  const clamped = Math.max(0, Math.min(180, displayAngle))

  // Arc color logic:
  // - grey when NO_POSE
  // - primary blue when below target
  // - accent emerald when target reached
  // - rose when compensation detected
  const arcColor = !hasPose
    ? '#94a3b8'
    : compensation
      ? '#f43f5e'
      : reached
        ? '#10B981'
        : '#0B5394'

  const tickColor = '#0B5394'

  // Tick mark for the target angle.
  const tickInner = polar(target, R - STROKE / 2 - 4)
  const tickOuter = polar(target, R + STROKE / 2 + 4)

  return (
    <div
      className="relative flex flex-col items-center"
      role="img"
      aria-label={`Elbow angle ${hasPose ? `${clamped.toFixed(0)} of ${target} degrees` : 'no pose'}${compensation ? ', compensation detected' : ''}`}
    >
      <svg
        width={SIZE}
        height={SIZE / 2 + 30}
        viewBox={`0 0 ${SIZE} ${SIZE / 2 + 30}`}
        className="overflow-visible"
      >
        {/* Track (full 180° background arc) */}
        <path
          d={arcPath(0, 180, R)}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="text-muted/30"
        />
        {/* Tick marks every 30° */}
        {Array.from({ length: 7 }, (_, i) => i * 30).map((deg) => {
          const inner = polar(deg, R - STROKE / 2 - 1)
          const outer = polar(deg, R - STROKE / 2 + 1)
          return (
            <line
              key={deg}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-muted-foreground/40"
            />
          )
        })}
        {/* Value arc (0 → clamped) */}
        {hasPose && (
          <path
            d={arcPath(0, clamped, R)}
            fill="none"
            stroke={arcColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            style={{ transition: 'stroke 200ms, d 120ms' }}
          />
        )}
        {/* Target tick mark */}
        <line
          x1={tickInner.x}
          y1={tickInner.y}
          x2={tickOuter.x}
          y2={tickOuter.y}
          stroke={tickColor}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={tickOuter.x} cy={tickOuter.y} r={3.5} fill={tickColor} />
      </svg>

      {/* Numeric readout */}
      <div className="-mt-2 flex flex-col items-center text-center">
        <div
          className={cn(
            'font-mono text-4xl font-bold tabular-nums leading-none',
            hasPose ? 'text-foreground' : 'text-muted-foreground/50',
          )}
        >
          {hasPose ? `${clamped.toFixed(0)}°` : '—'}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          target <span className="font-mono font-semibold text-primary">{target}°</span>
        </div>
        {simulated && (
          <div className="mt-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
            simulated
          </div>
        )}
      </div>
    </div>
  )
}
