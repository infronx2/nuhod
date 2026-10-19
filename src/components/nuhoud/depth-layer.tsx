'use client'

import * as React from 'react'

const MAX_TILT_DEG = 4

/**
 * One pointer listener for the whole page that tilts the [data-tilt] element under the
 * pointer toward it (CSS variables --rx / --ry, see globals.css). Mounted once in the root layout;
 * touch screens and reduced-motion users get no tilt.
 */
export function DepthLayer() {
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(hover: hover)').matches) return
    let active: HTMLElement | null = null
    let frame = 0

    const reset = (el: HTMLElement) => {
      el.style.setProperty('--rx', '0deg')
      el.style.setProperty('--ry', '0deg')
    }
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tilt]') ?? null
      if (active && active !== el) reset(active)
      active = el
      if (!el) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width - 0.5
        const y = (e.clientY - r.top) / r.height - 0.5
        el.style.setProperty('--rx', `${(-y * MAX_TILT_DEG).toFixed(2)}deg`)
        el.style.setProperty('--ry', `${(x * MAX_TILT_DEG).toFixed(2)}deg`)
      })
    }
    const onLeave = () => {
      if (active) reset(active)
      active = null
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])
  return null
}
