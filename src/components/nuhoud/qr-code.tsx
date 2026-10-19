'use client'

import * as React from 'react'
import { qrMatrix } from '@/lib/qr'

/** A QR code as one SVG path (dark modules on white, with the standard quiet zone). */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const { size, d } = React.useMemo(() => {
    const m = qrMatrix(value)
    let path = ''
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + 4} ${y + 4}h1v1h-1z` }))
    return { size: m.length + 8, d: path }
  }, [value])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="QR" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

/** The sign-in link inside a patient's QR code; the token rides in the fragment, so it never reaches server logs. */
export function qrSignInUrl(token: string): string {
  return `${window.location.origin}/q#${token}`
}
