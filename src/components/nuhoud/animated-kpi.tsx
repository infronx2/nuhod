'use client'

import * as React from 'react'
import { motion, useMotionValue, animate as framerAnimate } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * KPI tile that counts up from 0 to `value` on mount.
 *
 * Uses framer-motion's `useMotionValue` + `animate` for a smooth rAF-driven
 * counter. Renders the formatted value via children, or a default format.
 *
 * Hover: subtle pulse + lift.
 */
interface AnimatedKpiProps {
  value: number
  label: string
  icon?: React.ComponentType<{ className?: string }>
  accent?: 'primary' | 'accent' | 'secondary' | 'emerald' | 'rose'
  /** Optional suffix (e.g. "°", "%"). */
  suffix?: string
  /** Optional sub-label. */
  hint?: string
  className?: string
}

const ACCENTS: Record<NonNullable<AnimatedKpiProps['accent']>, string> = {
  primary: 'text-primary',
  accent: 'text-accent',
  secondary: 'text-secondary',
  emerald: 'text-accent',
  rose: 'text-rose-500',
}

export function AnimatedKpi({
  value,
  label,
  icon: Icon,
  accent = 'primary',
  suffix = '',
  hint,
  className,
}: AnimatedKpiProps) {
  const countRef = React.useRef<HTMLSpanElement | null>(null)
  const motionValue = useMotionValue(0)

  React.useEffect(() => {
    const controls = framerAnimate(motionValue, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (countRef.current) {
          countRef.current.textContent =
            Math.round(v).toLocaleString() + suffix
        }
      },
    })
    return () => controls.stop()
  }, [value, suffix, motionValue])

  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative flex flex-col gap-1 overflow-hidden rounded-xl border border-border/40 bg-card/60 p-4 shadow-lg shadow-black/20 backdrop-blur transition-shadow hover:shadow-xl',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={cn('h-4 w-4', ACCENTS[accent])} />}
      </div>
      <span
        ref={countRef}
        className={cn('font-mono text-2xl font-bold tabular-nums', ACCENTS[accent])}
      >
        0{suffix}
      </span>
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </motion.div>
  )
}
