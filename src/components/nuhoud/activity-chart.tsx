'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { Activity } from 'lucide-react'

interface ActivityChartProps {
  data: { day: string; reps: number }[]
  loading?: boolean
}

function formatDay(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString((document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-GB'), { weekday: 'short' })
  } catch {
    return iso
  }
}

function formatDayShort(iso: string): string {
  // Arabic day names don't shorten to three letters ("الث" is no day): drop the article instead.
  return document.documentElement.lang === 'ar' ? formatDay(iso).replace(/^ال/, '') : formatDay(iso).slice(0, 3)
}

/**
 * ActivityChart — 7-day bar chart of reps per day from /api/v2/stats.
 * Teal bars with a hover tooltip and responsive sizing.
 */
export function ActivityChart({ data, loading }: ActivityChartProps) {
  const tu = useTranslations('ui')
  const chartData = React.useMemo(
    () =>
      (data ?? []).map((d) => ({
        label: formatDayShort(d.day),
        reps: d.reps,
        iso: d.day,
      })),
    [data],
  )

  const total = chartData.reduce((s, x) => s + (x.reps || 0), 0)
  const maxReps = Math.max(1, ...chartData.map((d) => d.reps))

  return (
    <div className="flex h-64 w-full flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold">{tu('act7')}</h3>
          <p className="text-[11px] text-muted-foreground">
            {tu('act7Desc')}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold text-primary">{total}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {tu('totalReps')}
          </div>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : chartData.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Activity className="h-8 w-8 opacity-40" />
          <p className="text-xs">{tu('noActivity')}</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="80%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(148,163,184,0.18)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              stroke="rgba(148,163,184,0.4)"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              stroke="rgba(148,163,184,0.4)"
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(11, 83, 148,0.08)' }}
              contentStyle={{
                background: 'rgba(15,23,42,0.96)',
                border: '1px solid rgba(148,163,184,0.25)',
                borderRadius: 8,
                fontSize: 11,
                color: '#e2e8f0',
              }}
              labelFormatter={(_, payload) => {
                const iso = payload?.[0]?.payload?.iso as string | undefined
                if (!iso) return ''
                const d = new Date(iso)
                return Number.isNaN(d.getTime())
                  ? iso
                  : d.toLocaleDateString((document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-GB'), {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    })
              }}
              formatter={(value: number) => [`${value} reps`, 'Reps']}
            />
            <Bar dataKey="reps" radius={[6, 6, 0, 0]} maxBarSize={36}>
              {chartData.map((d) => (
                <Cell
                  key={d.iso}
                  fill={d.reps === 0 ? 'rgba(148,163,184,0.25)' : '#0B5394'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="mt-1 text-[10px] text-muted-foreground">
        {tu('maxPerDay', { n: maxReps })}
      </div>
    </div>
  )
}
