'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

interface HeatmapCell {
  date: string
  dayOfWeek: number
  reps: number
  sessions: number
}

interface HeatmapProps {
  /** If provided, scopes the heatmap to one patient. Doctors omit for global. */
  patientId?: string
  weeks?: number
  /** Title shown in the card header. */
  title?: string
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * ActivityHeatmap — a GitHub-style calendar heatmap showing reps per day
 * over the last N weeks. 7 rows (days of week) × N columns (weeks).
 *
 * Color scale (primary blue, accessibility-safe):
 *   0 reps   → muted (no activity)
 *   low      → primary/30
 *   mid      → primary/55
 *   high     → primary/75
 *   max      → primary (solid)
 */
export function ActivityHeatmap({ patientId, weeks = 12, title = 'Activity heatmap' }: HeatmapProps) {
  const [cells, setCells] = React.useState<HeatmapCell[]>([])
  const [maxReps, setMaxReps] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [hovered, setHovered] = React.useState<HeatmapCell | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = `?weeks=${weeks}${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ''}`
    apiFetch<{ ok: boolean; cells: HeatmapCell[]; maxReps: number }>(`/api/v2/stats/heatmap${qs}`)
      .then((data) => {
        if (cancelled || !data.ok) return
        setCells(data.cells)
        setMaxReps(data.maxReps)
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [patientId, weeks])

  const colorForReps = (reps: number): string => {
    if (reps === 0 || maxReps === 0) return 'bg-muted/40'
    const ratio = reps / maxReps
    if (ratio < 0.25) return 'bg-primary/30'
    if (ratio < 0.5) return 'bg-primary/55'
    if (ratio < 0.75) return 'bg-primary/75'
    return 'bg-primary'
  }

  // Group cells into columns of 7 (one column per week, top = Sunday).
  const columns: HeatmapCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    columns.push(cells.slice(i, i + 7))
  }

  // Month labels: for each column, the month of its first cell's date — but
  // only show when the month changes (to avoid label clutter).
  const monthLabels: Array<{ col: number; label: string }> = []
  let lastMonth = -1
  columns.forEach((col, colIdx) => {
    if (col.length === 0) return
    const month = new Date(col[0].date).getMonth()
    if (month !== lastMonth) {
      monthLabels.push({ col: colIdx, label: MONTH_LABELS[month] })
      lastMonth = month
    }
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {hovered && (
          <span className="ml-auto text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{hovered.date}</span>
            {' · '}
            {hovered.reps > 0
              ? `${hovered.reps} reps · ${hovered.sessions} session${hovered.sessions === 1 ? '' : 's'}`
              : 'no activity'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex gap-1 overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1">
              {Array.from({ length: 7 }).map((_, j) => (
                <Skeleton key={j} className="h-3 w-3 rounded-sm" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="nm-scroll-thin overflow-x-auto pb-1">
          <div className="inline-flex flex-col gap-1">
            {/* Month labels row */}
            <div className="flex gap-1 pl-8" style={{ minWidth: columns.length * 16 }}>
              {columns.map((_, colIdx) => {
                const label = monthLabels.find((m) => m.col === colIdx)
                return (
                  <div
                    key={colIdx}
                    className="w-3 text-[9px] leading-none text-muted-foreground"
                    style={{ minWidth: 12 }}
                  >
                    {label ? label.label : ''}
                  </div>
                )
              })}
            </div>
            {/* Day grid */}
            <div className="flex gap-1">
              {/* Day labels column */}
              <div className="flex flex-col gap-1 pr-1">
                {DAY_LABELS.map((d, i) => (
                  <div
                    key={d}
                    className="flex h-3 items-center text-[9px] leading-none text-muted-foreground/70"
                  >
                    {i % 2 === 1 ? d : ''}
                  </div>
                ))}
              </div>
              {/* Heatmap columns */}
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-1">
                  {Array.from({ length: 7 }).map((_, rowIdx) => {
                    const cell = col[rowIdx]
                    if (!cell) return <div key={rowIdx} className="h-3 w-3" />
                    return (
                      <motion.div
                        key={rowIdx}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2, delay: (colIdx * 7 + rowIdx) * 0.005 }}
                        whileHover={{ scale: 1.3 }}
                        onMouseEnter={() => setHovered(cell)}
                        onMouseLeave={() => setHovered(null)}
                        className={cn(
                          'h-3 w-3 rounded-sm ring-1 ring-inset ring-black/5 transition-colors',
                          colorForReps(cell.reps),
                        )}
                        title={`${cell.date} · ${cell.reps} reps`}
                        role="img"
                        aria-label={`${cell.date}: ${cell.reps} reps, ${cell.sessions} sessions`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
            <span>Less</span>
            <div className="flex gap-0.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-muted/40" />
              <div className="h-2.5 w-2.5 rounded-sm bg-primary/30" />
              <div className="h-2.5 w-2.5 rounded-sm bg-primary/55" />
              <div className="h-2.5 w-2.5 rounded-sm bg-primary/75" />
              <div className="h-2.5 w-2.5 rounded-sm bg-primary" />
            </div>
            <span>More</span>
          </div>
        </div>
      )}
    </div>
  )
}
