'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, Trophy, Plus, Loader2, Check, Flame, Activity, Gauge, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

interface Goal {
  id: string
  type: string
  title: string
  targetValue: number
  currentValue: number
  achieved: boolean
  achievedAt: string | null
  targetDate: string | null
  createdAt: string
}

interface SessionSample {
  maxAchievedAngle: number
  totalReps: number
  correctReps: number
  sessionDate: string
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  rom_target: Flame,
  rep_count: Activity,
  accuracy: Gauge,
  streak: Trophy,
}

const TYPE_UNIT: Record<string, string> = {
  rom_target: '°',
  rep_count: ' reps',
  accuracy: '%',
  streak: ' days',
}

interface GoalsTrackerProps {
  /** Optional: fetch a specific patient's goals (for doctor views). Defaults to the current user. */
  patientId?: string
}

/**
 * GoalsTracker — shows the patient's active + achieved rehabilitation
 * goals with animated progress bars. Achieved goals get a celebratory
 * checkmark + trophy. Doctors see a delete button per goal.
 */
export function GoalsTracker({ patientId }: GoalsTrackerProps = {}) {
  const { user } = useAuth()
  const isDoctor = user?.role.toUpperCase() === 'DOCTOR' || user?.role.toUpperCase() === 'ADMIN'
  const [goals, setGoals] = React.useState<Goal[]>([])
  const [sessions, setSessions] = React.useState<SessionSample[]>([])
  const [loading, setLoading] = React.useState(true)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const fetchGoals = React.useCallback(async () => {
    if (!user) return
    try {
      const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''
      const [goalsData, sessionsData] = await Promise.all([
        apiFetch<{ ok: boolean; goals: Goal[] }>(`/api/v2/goals${qs}`),
        apiFetch<{ ok: boolean; sessions: SessionSample[] }>(`/api/v2/sessions${qs ? qs + '&limit=30' : '?limit=30'}`),
      ])
      if (goalsData.ok) setGoals(goalsData.goals)
      if (sessionsData.ok) {
        // Reverse to oldest-first for the sparkline.
        setSessions([...(sessionsData.sessions ?? [])].reverse())
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [user, patientId])

  React.useEffect(() => { void fetchGoals() }, [fetchGoals])

  const handleDelete = React.useCallback(async (goalId: string, title: string) => {
    setDeletingId(goalId)
    try {
      await apiFetch(`/api/v2/goals/${goalId}`, { method: 'DELETE' })
      setGoals((prev) => prev.filter((g) => g.id !== goalId))
      toast.success('Goal deleted', { description: `"${title}" removed.` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      toast.error('Could not delete goal', { description: msg })
    } finally {
      setDeletingId(null)
    }
  }, [])

  if (loading) {
    return (
      <Card className="border-border/40 bg-card/60 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Goals</h3>
        </div>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Card>
    )
  }

  if (goals.length === 0) {
    return null // Don't show an empty card — goals are doctor-set.
  }

  return (
    <Card className="border-border/40 bg-card/60 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Rehabilitation goals</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {goals.filter((g) => g.achieved).length}/{goals.length} achieved
        </span>
      </div>

      <div className="mt-3 space-y-2.5">
        <AnimatePresence mode="popLayout">
          {goals.map((g, i) => {
            const Icon = TYPE_ICON[g.type] ?? Target
            const unit = TYPE_UNIT[g.type] ?? ''
            const pct = Math.min(100, (g.currentValue / g.targetValue) * 100)
            return (
              <motion.div
                key={g.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
                className={cn(
                  'rounded-lg border p-2.5',
                  g.achieved
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-border/40 bg-card/40',
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full',
                    g.achieved ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground',
                  )}>
                    {g.achieved ? <Check className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">{g.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {g.currentValue.toFixed(0)}{unit} / {g.targetValue}{unit}
                    </p>
                  </div>
                  {g.achieved && <Trophy className="h-3.5 w-3.5 text-accent" />}
                  {isDoctor && (
                    <button
                      onClick={() => handleDelete(g.id, g.title)}
                      disabled={deletingId === g.id}
                      className="ml-1 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                      aria-label={`Delete goal ${g.title}`}
                    >
                      {deletingId === g.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                  <motion.div
                    className={cn(
                      'h-full rounded-full',
                      g.achieved
                        ? 'bg-gradient-to-r from-emerald-400 to-primary'
                        : 'bg-gradient-to-r from-primary to-emerald-500',
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.05 + 0.1 }}
                  />
                </div>

                {/* Per-session sparkline (only for ROM/rep/accuracy goals with ≥3 sessions) */}
                {g.type !== 'streak' && sessions.length >= 3 && (
                  <GoalSparkline
                    goal={g}
                    sessions={sessions}
                  />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </Card>
  )
}

/**
 * GoalSparkline — a tiny inline SVG sparkline showing the per-session
 * metric values relevant to this goal's type, with a dashed target line.
 */
function GoalSparkline({ goal, sessions }: { goal: Goal; sessions: SessionSample[] }) {
  const values = React.useMemo(() => {
    return sessions.map((s) => {
      if (goal.type === 'rom_target') return s.maxAchievedAngle
      if (goal.type === 'rep_count') return s.totalReps
      if (goal.type === 'accuracy') return s.totalReps > 0 ? (s.correctReps / s.totalReps) * 100 : 0
      return 0
    })
  }, [goal.type, sessions])

  if (values.length < 2) return null

  const W = 100
  const H = 20
  const max = Math.max(goal.targetValue, ...values, 1)
  const min = 0
  const range = max - min || 1
  const stepX = W / Math.max(1, values.length - 1)
  const points = values.map((v, i) => {
    const x = i * stepX
    const y = H - ((v - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Target line Y position.
  const targetY = H - ((goal.targetValue - min) / range) * H
  const achievedColor = goal.achieved ? '#10b981' : '#0B5394'

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <svg width={W} height={H} className="shrink-0" viewBox={`0 0 ${W} ${H}`}>
        {/* Target dashed line */}
        <line
          x1="0" y1={targetY} x2={W} y2={targetY}
          stroke="#f59e0b"
          strokeWidth="0.8"
          strokeDasharray="2 2"
          opacity="0.6"
        />
        {/* Sparkline polyline */}
        <polyline
          points={points}
          fill="none"
          stroke={achievedColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last-point dot */}
        {values.length > 0 && (
          <circle
            cx={((values.length - 1) * stepX).toFixed(1)}
            cy={(H - ((values[values.length - 1] - min) / range) * H).toFixed(1)}
            r="1.5"
            fill={achievedColor}
          />
        )}
      </svg>
      <span className="text-[9px] text-muted-foreground">
        {values.length} sessions · last: {values[values.length - 1].toFixed(0)}
        {goal.type === 'rom_target' ? '°' : goal.type === 'accuracy' ? '%' : ''}
      </span>
    </div>
  )
}
