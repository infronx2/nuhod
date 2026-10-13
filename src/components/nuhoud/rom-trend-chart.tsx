'use client'

import * as React from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'
import type { V2Session } from '@/lib/v2-types'

interface RomTrendChartProps {
  sessions: V2Session[]
  loading?: boolean
  /** Optional target angle reference line (from active plan). */
  targetAngle?: number
}

function formatSessionDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch {
    return iso
  }
}

/**
 * RomTrendChart — line chart of maxAchievedAngle across recent sessions.
 * Shows range-of-motion progress over time, with an optional target-angle
 * reference line (from the patient's active treatment plan).
 *
 * Sessions come in DESC order (most recent first) from /api/v2/patients/[id];
 * we reverse to ASCENDING order for the time axis.
 */
export function RomTrendChart({ sessions, loading, targetAngle }: RomTrendChartProps) {
  const chartData = React.useMemo(() => {
    const ascending = [...sessions].reverse()
    return ascending.map((s, i) => ({
      idx: i + 1,
      label: formatSessionDate(s.sessionDate),
      angle: Math.round(s.maxAchievedAngle * 100) / 100,
    }))
  }, [sessions])

  const maxAngle = Math.max(
    targetAngle ?? 0,
    ...chartData.map((d) => d.angle),
    90,
  )
  const yMax = Math.min(180, Math.ceil((maxAngle + 10) / 10) * 10)

  return (
    <div className="flex h-64 w-full flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold">ROM trend</h3>
          <p className="text-[11px] text-muted-foreground">
            Max achieved angle per session
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold text-primary">
            {chartData.length > 0
              ? Math.max(...chartData.map((d) => d.angle)).toFixed(0)
              : '—'}
            °
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            best max
          </div>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : chartData.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
          <TrendingUp className="h-8 w-8 opacity-40" />
          <p className="text-xs">No sessions yet — ROM trend will appear here.</p>
        </div>
      ) : chartData.length === 1 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
          <TrendingUp className="h-8 w-8 opacity-40" />
          <p className="text-xs">
            1 session recorded. Need 2+ to plot a trend.
          </p>
          <div className="font-mono text-sm font-bold text-primary">
            {chartData[0].angle}°
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="80%">
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
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
              minTickGap={12}
            />
            <YAxis
              domain={[0, yMax]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              stroke="rgba(148,163,184,0.4)"
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.96)',
                border: '1px solid rgba(148,163,184,0.25)',
                borderRadius: 8,
                fontSize: 11,
                color: '#e2e8f0',
              }}
              formatter={(value: number) => [`${value}°`, 'Max angle']}
              labelFormatter={(label) => `Session ${label}`}
            />
            {typeof targetAngle === 'number' && targetAngle > 0 && (
              <ReferenceLine
                y={targetAngle}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{
                  value: `Target ${targetAngle}°`,
                  position: 'insideTopRight',
                  fontSize: 9,
                  fill: '#f59e0b',
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="angle"
              stroke="#f59e0b"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 1 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
