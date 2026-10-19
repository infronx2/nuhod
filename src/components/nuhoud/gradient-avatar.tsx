'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Renders the user's avatar as a deterministic CSS gradient
 * using their `avatarSeed` hex color (from the User table). Falls back to a
 * primary gradient when no seed is provided. The user's initials (first letter of
 * the first two name tokens) are overlaid in white bold.
 *
 * `size` accepts any Tailwind height/width pair; defaults to `h-10 w-10`.
 */
interface GradientAvatarProps {
  seed?: string | null
  name: string
  className?: string
  size?: string
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean) && !/^[0-9a-fA-F]{3}$/.test(clean)) {
    return null
  }
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return { r, g, b }
}

/** Darken an RGB color by multiplying each channel by `f` (0..1). */
function darken({ r, g, b }: { r: number; g: number; b: number }, f = 0.65) {
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function GradientAvatar({
  seed,
  name,
  className,
  size = 'h-10 w-10',
}: GradientAvatarProps) {
  // Compute deterministic gradient; safe during SSR (no random, no Date).
  const rgb = hexToRgb(seed || '14b8a6') || { r: 20, g: 184, b: 166 }
  const from = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
  const to = darken(rgb, 0.65)

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-sm',
        size,
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
      }}
      aria-label={`Avatar for ${name}`}
      role="img"
    >
      <span className="select-none leading-none drop-shadow-sm">
        {initialsOf(name)}
      </span>
    </div>
  )
}
