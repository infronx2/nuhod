'use client'

import * as React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AccuracyDonutProps {
  correctReps: number
  compensatedReps: number
  /** Optional accuracy percentage override; computed if omitted. */
  accuracyPct?: number
  size?: number
  className?: string
}

/**
 * AccuracyDonut — reusable donut chart of correct vs compensated reps.
 * Reuses the pattern from session-history but is parameterised so the
 * doctor dashboard, patient-detail view and the legacy dashboard can all
 * share it.
 */
export function AccuracyDonut({
  correctReps,
  compensatedReps,
  accuracyPct,
  size = 140,
  className,
}: AccuracyDonutProps) {
  const total = Math.max(0, correctReps + compensatedReps)
  const accuracy =
    accuracyPct ?? (total > 0 ? (correctReps / total) * 100 : 0)

  const data = [
    { name: 'Correct', value: Math.max(0, correctReps), color: '#10b981' },
    { name: 'Compensated', value: Math.max(0, compensatedReps), color: '#f43f5e' },
  ].filter((d) => d.value > 0)

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.length > 0 ? data : [{ name: 'None', value: 1, color: 'rgba(148,163,184,0.18)' }]}
              dataKey="value"
              nameKey="name"
              innerRadius={size * 0.28}
              outerRadius={size * 0.46}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {(data.length > 0 ? data : [{ name: 'None', value: 1, color: 'rgba(148,163,184,0.18)' }]).map(
                (d) => (
                  <Cell key={d.name} fill={d.color} />
                ),
              )}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.96)',
                border: '1px solid rgba(148,163,184,0.25)',
                borderRadius: 8,
                fontSize: 11,
                color: '#e2e8f0',
              }}
              formatter={(value: number, name: string) => [`${value} reps`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-bold text-emerald-500">
            {accuracy.toFixed(0)}%
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            accuracy
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
          <span className="text-muted-foreground">Correct</span>
          <span className="font-mono font-semibold">{correctReps}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" aria-hidden="true" />
          <span className="text-muted-foreground">Comp.</span>
          <span className="font-mono font-semibold">{compensatedReps}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-semibold">{total}</span>
        </div>
      </div>
      {total === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {accuracy >= 80 ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
          <span>No reps recorded yet</span>
        </div>
      )}
    </div>
  )
}
