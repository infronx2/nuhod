'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Hand, Activity, Target, Dumbbell } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface LimbBreakdownProps {
  sessions: Array<{
    limb: string
    totalReps: number
    correctReps: number
    compensationErrors: number
    maxAchievedAngle: number
  }>
  loading?: boolean
}

interface LimbStat {
  limb: string
  label: string
  sessions: number
  reps: number
  correctReps: number
  compErrors: number
  accuracy: number
  maxAngle: number
  share: number // fraction of total reps
}

const LIMB_META: Record<string, { label: string; color: string; ring: string }> = {
  right: { label: 'Right', color: 'text-primary', ring: 'border-primary/40 bg-primary/5' },
  left: { label: 'Left', color: 'text-secondary', ring: 'border-secondary/40 bg-secondary/5' },
  bilateral: { label: 'Bilateral', color: 'text-rose-500', ring: 'border-rose-500/40 bg-rose-500/5' },
}

/**
 * LimbBreakdown — a compact card showing per-limb stats (sessions, reps,
 * accuracy, max ROM, compensation errors) for the patient's recent sessions.
 *
 * Clinical use: a clinician comparing left vs right recovery can spot which
 * side is lagging and adjust the plan accordingly. For unilateral stroke
 * patients (the common case), the "affected" side should show lower accuracy
 * and more compensation errors.
 */
export function LimbBreakdown({ sessions, loading }: LimbBreakdownProps) {
  const stats = React.useMemo<LimbStat[]>(() => {
    const byLimb = new Map<string, LimbStat>()
    for (const s of sessions) {
      const key = s.limb || 'right'
      const cur = byLimb.get(key) ?? {
        limb: key,
        label: LIMB_META[key]?.label ?? key,
        sessions: 0,
        reps: 0,
        correctReps: 0,
        compErrors: 0,
        accuracy: 0,
        maxAngle: 0,
        share: 0,
      }
      cur.sessions += 1
      cur.reps += s.totalReps
      cur.correctReps += s.correctReps
      cur.compErrors += s.compensationErrors
      cur.maxAngle = Math.max(cur.maxAngle, s.maxAchievedAngle)
      byLimb.set(key, cur)
    }
    const totalReps = Array.from(byLimb.values()).reduce((s, x) => s + x.reps, 0)
    const arr = Array.from(byLimb.values())
    for (const x of arr) {
      x.accuracy = x.reps > 0 ? Math.round((x.correctReps / x.reps) * 1000) / 10 : 0
      x.share = totalReps > 0 ? x.reps / totalReps : 0
    }
    // Sort by reps desc so the dominant limb is first.
    arr.sort((a, b) => b.reps - a.reps)
    return arr
  }, [sessions])

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-24 flex-1" />
          <Skeleton className="h-24 flex-1" />
        </div>
      </div>
    )
  }

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Hand className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No limb data yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Hand className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Per-limb breakdown</h3>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {stats.map((s, i) => {
          const meta = LIMB_META[s.limb] ?? LIMB_META.right
          return (
            <motion.div
              key={s.limb}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.08 }}
              className={cn(
                'flex flex-col gap-2 rounded-xl border p-3',
                meta.ring,
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn('text-xs font-bold uppercase tracking-wide', meta.color)}>
                  {meta.label} side
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(s.share * 100)}% of reps
                </span>
              </div>

              {/* Share bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${s.share * 100}%` }}
                  transition={{ duration: 0.5, delay: i * 0.08 + 0.1 }}
                />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <Stat icon={Activity} label="Sessions" value={String(s.sessions)} />
                <Stat icon={Dumbbell} label="Reps" value={String(s.reps)} />
                <Stat icon={Target} label="Accuracy" value={`${s.accuracy}%`} />
                <Stat icon={Hand} label="Max ROM" value={`${Math.round(s.maxAngle)}°`} />
              </div>

              <div className="mt-0.5 flex items-center justify-between border-t border-border/30 pt-1.5">
                <span className="text-[10px] text-muted-foreground">Compensation errors</span>
                <span
                  className={cn(
                    'font-mono text-xs font-bold',
                    s.compErrors > s.sessions * 2 ? 'text-rose-500' : 'text-emerald-500',
                  )}
                >
                  {s.compErrors}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    ({(s.sessions > 0 ? s.compErrors / s.sessions : 0).toFixed(1)}/sess)
                  </span>
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-muted-foreground/60" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-semibold text-foreground">{value}</span>
    </div>
  )
}
