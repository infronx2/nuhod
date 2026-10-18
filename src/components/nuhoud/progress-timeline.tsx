'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import {
  Stethoscope,
  Activity,
  Sparkles,
  Bell,
  TrendingUp,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

interface TimelineEntry {
  id: string
  type: string
  title: string
  body: string | null
  severity: string
  createdAt: string
}

interface ProgressTimelineProps {
  patientId: string
  loading?: boolean
}

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; ring: string; label: string }> = {
  plan_prescribed: { icon: Stethoscope, color: 'text-primary', ring: 'bg-primary/15 border-primary/40', label: 'plan' },
  session_saved: { icon: Activity, color: 'text-accent', ring: 'bg-accent/15 border-accent/40', label: 'session' },
  coach_summary: { icon: Sparkles, color: 'text-primary', ring: 'bg-primary/15 border-primary/40', label: 'coach' },
  info: { icon: Bell, color: 'text-secondary', ring: 'bg-secondary/15 border-secondary/40', label: 'info' },
}

const HIDDEN_TYPES = new Set(['badge_earned', 'streak_milestone'])

/**
 * ProgressTimeline — a vertical milestone timeline showing the patient's
 * rehabilitation journey: badges earned, plans prescribed, sessions saved,
 * streak milestones. Each entry is a card on a vertical line with a
 * color-coded icon node.
 *
 * Clinical + motivational use: gives the patient (and doctor) a visual
 * narrative of progress over time — the "story" of their recovery.
 */
export function ProgressTimeline({ patientId, loading = false }: ProgressTimelineProps) {
  const tu = useTranslations('ui')
  const [entries, setEntries] = React.useState<TimelineEntry[]>([])
  const [loadState, setLoadState] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  React.useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    // The patient's notifications ARE the timeline — each badge_earned,
    // plan_prescribed, session_saved event is a milestone. Pass userId so
    // a doctor viewing a patient sees THAT patient's milestones.
    apiFetch<{ ok: boolean; notifications: TimelineEntry[] }>(
      `/api/v2/notifications?limit=50&userId=${encodeURIComponent(patientId)}`,
    )
      .then((data) => {
        if (cancelled) return
        if (data.ok) {
          // Reverse to oldest-first for a chronological timeline.
          setEntries(
            [...data.notifications]
              .filter((n) => !HIDDEN_TYPES.has(n.type))
              .reverse(),
          )
          setLoadState('done')
        } else {
          setLoadState('error')
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [patientId])

  if (loadState === 'loading' || loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{tu('timeline')}</h3>
        </div>
        <div className="relative space-y-3 pl-6">
          <div className="absolute top-2 bottom-2 left-[7px] w-px bg-border/40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="relative flex gap-3">
              <div className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-border bg-card" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-48" />
                <Skeleton className="h-2 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/40">
          <TrendingUp className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground">{tu('noMilestones')}</p>
        <p className="text-xs text-muted-foreground/60">
          {tu('timelineHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{tu('timeline')}</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {tu('milestones', { n: entries.length })}
        </span>
      </div>

      <div className="relative space-y-2.5 pl-6">
        {/* Vertical line */}
        <div className="absolute top-3 bottom-3 left-[7px] w-px bg-gradient-to-b from-primary/40 via-border/40 to-transparent" />

        {entries.slice(-15).reverse().map((entry, i) => {
          const meta = TYPE_META[entry.type] ?? TYPE_META.info
          const Icon = meta.icon
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="relative"
            >
              {/* Node */}
              <div
                className={cn(
                  'absolute -left-6 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2',
                  meta.ring,
                )}
              >
                <Icon className={cn('h-2 w-2', meta.color)} />
              </div>

              {/* Card */}
              <div className="rounded-lg border border-border/40 bg-card/60 p-2.5 transition-colors hover:border-border/70 hover:bg-card/80">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-[10px] font-bold uppercase tracking-wide', meta.color)}>
                    {tu(`tl_${meta.label}`)}
                  </span>
                  <span className="text-[9px] text-muted-foreground/70">
                    {timeAgo(entry.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-foreground">{entry.title}</p>
                {entry.body && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {entry.body}
                  </p>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const sec = Math.round((d.getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' })
  const abs = Math.abs(sec)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 604800) return rtf.format(Math.round(sec / 86400), 'day')
  return d.toLocaleDateString(document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-GB', { day: '2-digit', month: 'short' })
}
