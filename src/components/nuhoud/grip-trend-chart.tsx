'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Hand } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import type { V2Session } from '@/lib/v2-types'

interface GripTrendChartProps {
  /** Newest first, as /api/v2/patients/[id] returns them. */
  sessions: V2Session[]
  loading?: boolean
}

function formatSessionDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString((document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-GB'), { day: '2-digit', month: 'short' })
}

/**
 * GripTrendChart — hand function from the majlis game per session: best fist closure (%) and the
 * closest thumb-index pinch (cm, lower is better). Sessions without hand data (web tracker) are
 * left out.
 */
export function GripTrendChart({ sessions, loading }: GripTrendChartProps) {
  const t = useTranslations('charts')
  const data = React.useMemo(
    () =>
      [...sessions]
        .reverse()
        .filter((s) => (s.gripClosureMax ?? 0) > 0 || (s.pinchMinCm ?? 0) > 0)
        .map((s) => ({
          label: formatSessionDate(s.sessionDate),
          grip: Math.round(s.gripClosureMax ?? 0),
          pinch: s.pinchMinCm ? Math.round(s.pinchMinCm * 10) / 10 : null,
        })),
    [sessions],
  )
  const bestGrip = data.reduce((m, d) => Math.max(m, d.grip), 0)

  return (
    <div className="flex h-64 w-full flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t('gripTitle')}</h3>
        <div className="font-mono text-xl font-bold text-emerald-500" dir="ltr">
          {data.length > 0 ? `${bestGrip}%` : '—'}
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : data.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <Hand className="h-8 w-8 opacity-40" />
          <p className="text-xs">{t('gripEmpty')}</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={data} margin={{ top: 4, right: 0, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              minTickGap={12}
            />
            <YAxis
              yAxisId="grip"
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
            />
            <YAxis
              yAxisId="pinch"
              orientation="right"
              domain={[0, 'auto']}
              reversed
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.96)',
                border: '1px solid rgba(148,163,184,0.25)',
                borderRadius: 8,
                fontSize: 11,
                color: '#e2e8f0',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              yAxisId="grip"
              type="monotone"
              dataKey="grip"
              name={t('gripPct')}
              stroke="#10b981"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="pinch"
              type="monotone"
              dataKey="pinch"
              name={t('pinchCm')}
              stroke="#a78bfa"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3, fill: '#a78bfa', strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
