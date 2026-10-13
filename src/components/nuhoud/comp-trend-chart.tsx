'use client'

import * as React from 'react'
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  LineChart,
} from 'recharts'
import { TrendingDown, AlertTriangle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface CompTrendChartProps {
  /** Sessions oldest-first for the chart's X axis. */
  sessions: Array<{
    sessionDate: string
    compensationErrors: number
    totalReps: number
    maxAchievedAngle: number
  }>
  loading?: boolean
}

/**
 * CompTrendChart — per-session compensation-error trend on the patient
 * detail page. Shows two layers:
 *  - An amber area + line of the rolling 5-session average (smoothed trend).
 *  - Rose scatter dots of the raw per-session compensation-error count.
 *
 * A horizontal "target" reference line at 2 errors/session (the clinical
 * threshold above which a plan reassessment is recommended) makes it
 * actionable: dots consistently above the line signal a compensation-pattern
 * regression.
 *
 * Clinical rationale: tracking compensation (shoulder shrugging) over time
 * is the single most useful leading indicator of motor-recovery plateaus —
 * patients often compensate MORE before they plateau, so a rising trend
 * warrants an early plan adjustment.
 */
export function CompTrendChart({ sessions, loading }: CompTrendChartProps) {
  const data = React.useMemo(() => {
    // Oldest-first for a left-to-right timeline.
    const sorted = [...sessions]
      .filter((s) => typeof s.compensationErrors === 'number')
      .reverse() // newest-first → reverse to oldest-first
    // Compute a rolling 5-session mean.
    const WINDOW = 5
    return sorted.map((s, i) => {
      const start = Math.max(0, i - WINDOW + 1)
      const slice = sorted.slice(start, i + 1)
      const avg = slice.reduce((sum, x) => sum + x.compensationErrors, 0) / slice.length
      return {
        idx: i,
        label: `S${i + 1}`,
        date: new Date(s.sessionDate).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
        }),
        raw: s.compensationErrors,
        avg: Math.round(avg * 10) / 10,
        reps: s.totalReps,
        maxAngle: Math.round(s.maxAchievedAngle),
      }
    })
  }, [sessions])

  const CLINICAL_THRESHOLD = 2

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No sessions recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingDown className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Compensation trend</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {data.length} sessions · target ≤ {CLINICAL_THRESHOLD}/session
        </span>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="compAvgFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/30" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: 'currentColor' }}
              stroke="currentColor"
              className="text-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'currentColor' }}
              stroke="currentColor"
              className="text-muted-foreground"
              width={28}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload
                return p ? `${p.date} · ${p.reps} reps · max ${p.maxAngle}°` : ''
              }}
              formatter={(v: number, name: string) => {
                if (name === 'avg') return [`${v} avg (5-session)`, 'trend']
                return [`${v} errors`, 'compensation']
              }}
            />
            <ReferenceLine
              y={CLINICAL_THRESHOLD}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `threshold ${CLINICAL_THRESHOLD}`,
                fontSize: 9,
                fill: '#f43f5e',
                position: 'insideTopRight',
              }}
            />
            <Area
              type="monotone"
              dataKey="avg"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#compAvgFill)"
              isAnimationActive={true}
              animationDuration={600}
            />
            <Scatter
              dataKey="raw"
              fill="#f43f5e"
              fillOpacity={0.7}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        Rose dots = per-session compensation errors · amber area = 5-session rolling average ·
        red line = clinical threshold. A rising trend signals a compensation-pattern regression.
      </p>
    </div>
  )
}
