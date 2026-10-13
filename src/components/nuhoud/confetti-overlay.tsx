'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

interface ConfettiOverlayProps {
  /** When true, fire a confetti burst. */
  active: boolean
  /** Called when the confetti animation finishes (after ~2.5s). */
  onDone?: () => void
  /** Optional headline shown in the center of the overlay. */
  headline?: string
  /** Optional sub-headline. */
  subheadline?: string
}

const COLORS = ['#0B5394', '#10B981', '#334155', '#64748B', '#3B82C4', '#0F172A']

/**
 * ConfettiOverlay — a lightweight canvas-based confetti burst that renders
 * in a portal (so it covers the whole viewport). Fires when `active` flips
 * to true. Self-cleans after ~2.5s.
 *
 * Used to celebrate goal achievements and streak milestones. No external
 * library — just requestAnimationFrame + a simple particle system.
 */
export function ConfettiOverlay({ active, onDone, headline, subheadline }: ConfettiOverlayProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!active || !mounted) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = window.innerWidth
    const H = window.innerHeight
    canvas.width = W
    canvas.height = H

    // Spawn ~120 particles from the top center.
    const N = 120
    const particles = Array.from({ length: N }).map(() => ({
      x: W / 2 + (Math.random() - 0.5) * 100,
      y: H / 3 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 12 - 4,
      size: Math.random() * 8 + 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      life: 1,
    }))

    let raf = 0
    let startTime = performance.now()
    const DURATION = 2500

    const tick = (now: number) => {
      const elapsed = now - startTime
      ctx.clearRect(0, 0, W, H)
      const gravity = 0.35
      for (const p of particles) {
        p.vy += gravity
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.rotationSpeed
        p.life = Math.max(0, 1 - elapsed / DURATION)
        ctx.save()
        ctx.globalAlpha = p.life
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }
      if (elapsed < DURATION) {
        raf = requestAnimationFrame(tick)
      } else {
        ctx.clearRect(0, 0, W, H)
        onDone?.()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [active, mounted, onDone])

  if (!mounted || !active) return null

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
      {(headline || subheadline) && (
        <div className="relative z-10 flex flex-col items-center gap-1 rounded-2xl bg-card/90 px-8 py-6 text-center shadow-2xl backdrop-blur-xl">
          {headline && (
            <h2 className="bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-3xl font-bold text-transparent">
              {headline}
            </h2>
          )}
          {subheadline && (
            <p className="text-sm text-muted-foreground">{subheadline}</p>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}
