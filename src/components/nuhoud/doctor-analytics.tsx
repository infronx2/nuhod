'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { BarChart3, Target, Gauge } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

interface Bucket {
  label: string
  min: number
  max: number
  count: number
}

interface Adherence {
  sessionsThisWeek: number
  targetPerWeek: number
  pct: number
}

interface DoctorAnalyticsProps {
  /** Global (no patientId) or per-patient. */
  patientId?: string
}

/**
 * DoctorAnalytics — a 2-up analytics card for the doctor dashboard:
 *  - Left: accuracy distribution histogram (how sessions spread across
 *    0-20%, 20-40%, ..., 80-100% accuracy buckets).
 *  - Right: plan-adherence gauge (sessions this week vs the plan's
 *    sessionsPerWeek target) as a circular progress dial.
 *
 * Together these answer "are my patients accurate?" and "are my patients
 * training enough?".
 */
export function DoctorAnalytics({ patientId }: DoctorAnalyticsProps) {
  const [buckets, setBuckets] = React.useState<Bucket[]>([])
  const [adherence, setAdherence] = React.useState<Adherence | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''
    apiFetch<{ ok: boolean; buckets: Bucket[]; adherence: Adherence }>(
      `/api/v2/stats/distribution${qs}`,
    )
      .then((data) => {
        if (cancelled || !data.ok) return
        setBuckets(data.buckets)
        setAdherence(data.adherence)
      })
      .catch(() => { /* silent */ })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [patientId])

  const maxCount = Math.max(1, ...buckets.map((b) => b.count))
  const BUCKET_COLOR = (min: number) => {
    if (min >= 80) return 'bg-emerald-500'
    if (min >= 60) return 'bg-primary'
    if (min >= 40) return 'bg-amber-500'
    if (min >= 20) return 'bg-orange-500'
    return 'bg-rose-500'
  }

  const adherencePct = adherence?.pct ?? 0
  const adherenceColor =
    adherencePct >= 80 ? '#10b981' : adherencePct >= 50 ? '#f59e0b' : '#f43f5e'

  // Circular gauge geometry.
  const R = 52
  const CIRC = 2 * Math.PI * R
  const dashOffset = CIRC - (adherencePct / 100) * CIRC

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Accuracy distribution histogram */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Accuracy distribution</h3>
        </div>
        {loading ? (
          <div className="flex h-40 items-end gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="flex-1" style={{ height: `${30 + i * 12}%` }} />
            ))}
          </div>
        ) : (
          <div className="flex h-40 items-end gap-2">
            {buckets.map((b, i) => {
              const h = (b.count / maxCount) * 100
              return (
                <div key={b.label} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-mono font-semibold text-foreground">
                    {b.count > 0 ? b.count : ''}
                  </span>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(h, b.count > 0 ? 4 : 0)}%` }}
                    transition={{ duration: 0.5, delay: i * 0.08, ease: 'easeOut' }}
                    className={cn(
                      'w-full rounded-t-md min-h-[2px]',
                      BUCKET_COLOR(b.min),
                    )}
                    title={`${b.label}: ${b.count} sessions`}
                  />
                  <span className="text-[9px] text-muted-foreground">{b.label}</span>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70">
          Sessions grouped by accuracy bracket · higher bars on the right = better form.
        </p>
      </div>

      {/* Plan adherence gauge */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Plan adherence</h3>
        </div>
        {loading || !adherence ? (
          <div className="flex h-40 items-center justify-center">
            <Skeleton className="h-32 w-32 rounded-full" />
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {/* Circular gauge */}
            <div className="relative h-32 w-32 shrink-0">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  className="text-muted/30"
                />
                <motion.circle
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  stroke={adherenceColor}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  initial={{ strokeDashoffset: CIRC }}
                  animate={{ strokeDashoffset: dashOffset }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="font-mono text-2xl font-bold"
                  style={{ color: adherenceColor }}
                >
                  {adherencePct}%
                </span>
                <span className="text-[9px] text-muted-foreground">on target</span>
              </div>
            </div>

            {/* Stats */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">This week</span>
                <span className="ml-auto font-mono text-sm font-semibold">
                  {adherence.sessionsThisWeek}
                  <span className="text-muted-foreground"> / {adherence.targetPerWeek}</span>
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {adherencePct >= 80
                  ? 'Excellent adherence — patients are hitting their weekly targets.'
                  : adherencePct >= 50
                    ? 'Moderate adherence — consider follow-up with patients under 50%.'
                    : 'Low adherence — patients need encouragement to meet weekly goals.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
