'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Sparkles, Target, Activity } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

interface WeeklyInsightsData {
  thisWeek: { sessions: number; reps: number; accuracy: number; maxAngle: number; score: number; compErrors: number }
  lastWeek: { sessions: number; reps: number }
  deltas: { reps: number; accuracy: number }
  bestSession: { date: string; maxAngle: number; reps: number } | null
  recommendation: string
}

/**
 * A patient-facing card summarizing the last 7 days:
 * reps/sessions/accuracy vs last week (with up/down deltas), the best
 * session, and a deterministic clinical recommendation.
 */
export function WeeklyInsights() {
  const tu = useTranslations('ui')
  const [data, setData] = React.useState<WeeklyInsightsData | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    apiFetch<{ ok: boolean; insights: WeeklyInsightsData }>('/api/v2/stats/weekly-insights')
      .then((d) => { if (!cancelled && d.ok) setData(d.insights) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || !data) {
    return (
      <Card className="border-border/40 bg-card/60 p-4 backdrop-blur">
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
        <Skeleton className="mt-3 h-12 w-full" />
      </Card>
    )
  }

  const tw = data.thisWeek
  const deltas = data.deltas

  return (
    <Card className="nm-glass border-border/40 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{tu('weeklyInsights')}</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">last 7 days</span>
      </div>

      {/* 3-up stat row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile
          icon={Activity}
          label={tu('sessions')}
          value={String(tw.sessions)}
          accent="primary"
        />
        <StatTile
          icon={TrendingUp}
          label={tu('reps')}
          value={String(tw.reps)}
          delta={deltas.reps}
          accent="accent"
        />
        <StatTile
          icon={Target}
          label={tu('accuracy')}
          value={`${tw.accuracy.toFixed(0)}%`}
          delta={deltas.accuracy}
          accent="secondary"
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 text-xs">
        <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 p-2">
          <Target className="h-3.5 w-3.5 text-primary" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">{tu('bestRomWeek')}</span>
            <span className="font-mono font-bold text-foreground">
              {tw.maxAngle.toFixed(0)}°
            </span>
          </div>
        </div>
      </div>

      {/* Coach recommendation */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="mt-2 rounded-lg border border-primary/30 bg-gradient-to-r from-primary/5 to-accent/5 p-2.5"
      >
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-foreground/90">
            {data.recommendation}
          </p>
        </div>
      </motion.div>
    </Card>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  delta,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  delta?: number
  accent: 'primary' | 'accent' | 'secondary'
}) {
  const accentColor = {
    primary: 'text-primary',
    accent: 'text-accent',
    secondary: 'text-secondary',
  }[accent]

  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border/40 bg-card/40 p-2 text-center">
      <Icon className={cn('h-3.5 w-3.5', accentColor)} />
      <span className="font-mono text-lg font-bold leading-none text-foreground">{value}</span>
      <span className="text-[9px] text-muted-foreground">{label}</span>
      {delta !== undefined && delta !== 0 && (
        <span
          className={cn(
            'flex items-center gap-0.5 text-[9px] font-medium',
            delta > 0 ? 'text-emerald-500' : 'text-rose-500',
          )}
        >
          {delta > 0 ? <TrendingUp className="h-2 w-2" /> : <TrendingDown className="h-2 w-2" />}
          {delta > 0 ? '+' : ''}{delta.toFixed(0)}
        </span>
      )}
    </div>
  )
}
