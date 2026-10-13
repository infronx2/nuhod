'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { RefreshCw, Activity, FileJson, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { apiFetch } from '@/lib/api'
import { FhirViewer } from '@/components/nuhoud/fhir-viewer'
import type {
  SessionRecord,
  SessionsResponse,
  StatsResponse,
} from '@/components/nuhoud/types'
import type {
  V2Session,
  V2SessionsResponse,
  V2Stats,
} from '@/lib/v2-types'

const V1_SESSIONS_URL = '/api/v1/sessions?XTransformPort=8001'
const V1_STATS_URL = '/api/v1/stats?XTransformPort=8001'

interface SessionHistoryProps {
  currentSnapshot: {
    repCount: number
    correctReps: number
    maxAchievedAngle: number
    compensationErrors: number
    score: number
    durationSeconds: number
  }
  /**
   * A monotonically-increasing counter. The component re-fetches its data
   * whenever this value changes — used so the parent (page) can trigger a
   * refresh after a session is saved via the tracking panel.
   */
  refreshSignal?: number
}

function formatDate(iso: string | Date): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

/**
 * SessionHistory — pulls persisted sessions and aggregate stats from either
 * the v1 Python backend (unauthenticated demo) or the v2 Next.js API
 * (authenticated patient/doctor).
 *
 * Authenticated mode also adds a per-row "View FHIR" button that opens the
 * FhirViewer dialog with the FHIR R4 Observation payload.
 */
export function SessionHistory({ currentSnapshot, refreshSignal = 0 }: SessionHistoryProps) {
  const { user } = useAuth()

  // Authenticated state (v2)
  const [v2Sessions, setV2Sessions] = React.useState<V2Session[]>([])
  const [v2Stats, setV2Stats] = React.useState<V2Stats | null>(null)
  const [loadingV2, setLoadingV2] = React.useState(false)

  // Unauthenticated state (v1 — kept for the demo fallback)
  const [v1Sessions, setV1Sessions] = React.useState<SessionRecord[]>([])
  const [v1Stats, setV1Stats] = React.useState<StatsResponse | null>(null)
  const [loadingV1, setLoadingV1] = React.useState(true)

  const [fhirSessionId, setFhirSessionId] = React.useState<string | null>(null)
  const [fhirOpen, setFhirOpen] = React.useState(false)

  const fetchV2 = React.useCallback(async () => {
    if (!user) return
    setLoadingV2(true)
    try {
      const patientId = user.role.toUpperCase() === 'DOCTOR' ? '' : user.id
      const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}&limit=50` : '?limit=50'
      const data = await apiFetch<V2SessionsResponse>(`/api/v2/sessions${qs}`)
      setV2Sessions(data.sessions ?? [])
      const stats = await apiFetch<V2Stats>(
        `/api/v2/stats${patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''}`,
      )
      setV2Stats(stats)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      toast.error('Could not load sessions', { description: msg })
    } finally {
      setLoadingV2(false)
    }
  }, [user])

  const fetchV1 = React.useCallback(async () => {
    setLoadingV1(true)
    try {
      const [s, st] = await Promise.all([
        fetch(V1_SESSIONS_URL).then((r) => r.json() as Promise<SessionsResponse>),
        fetch(V1_STATS_URL).then((r) => r.json() as Promise<StatsResponse>),
      ])
      setV1Sessions(s.sessions ?? [])
      setV1Stats(st)
    } catch {
      /* silent */
    } finally {
      setLoadingV1(false)
    }
  }, [])

  React.useEffect(() => {
    if (user) {
      void fetchV2()
    } else {
      void fetchV1()
      const id = window.setInterval(() => void fetchV1(), 10_000)
      return () => window.clearInterval(id)
    }
  }, [user, fetchV2, fetchV1, refreshSignal])

  const handleViewFhir = (sessionId: string) => {
    setFhirSessionId(sessionId)
    setFhirOpen(true)
  }

  // Aggregate stats for the donut.
  const totalReps = user ? (v2Stats?.totalReps ?? 0) : (v1Stats?.total_reps ?? 0)
  const totalCorrect = user
    ? (v2Stats?.totalCorrectReps ?? 0)
    : (v1Stats?.total_correct_reps ?? 0)
  const totalComp = Math.max(0, totalReps - totalCorrect)
  const accuracy = user ? (v2Stats?.accuracyPct ?? 0) : (v1Stats?.accuracy_pct ?? 0)
  const totalCount = user ? (v2Stats?.count ?? 0) : (v1Stats?.count ?? 0)
  const totalScore = user ? (v2Stats?.totalScore ?? 0) : (v1Stats?.total_score ?? 0)

  const pieData = [
    { name: 'Correct', value: totalCorrect, color: '#10b981' },
    { name: 'Compensated', value: totalComp, color: '#f43f5e' },
  ].filter((d) => d.value > 0)

  const loading = user ? loadingV2 : loadingV1
  const sessions = user ? v2Sessions : v1Sessions

  return (
    <section
      aria-label="Session history"
      className="rounded-xl border border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Session History
          </h2>
          <p className="text-sm text-muted-foreground">
            {user
              ? 'Persisted sessions from /api/v2/sessions — authenticated as ' +
                user.name +
                '.'
              : 'Demo sessions from the Python /api/v1/sessions endpoint.'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5"
          onClick={() => {
            if (user) void fetchV2()
            else void fetchV1()
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Sessions table */}
        <Card className="lg:col-span-3">
          <div className="border-b border-border/60 p-3">
            <h3 className="text-sm font-semibold text-foreground">Recent Sessions</h3>
          </div>
          <div className="nm-scroll-thin max-h-96 overflow-y-auto">
            {loading && sessions.length === 0 ? (
              <div className="p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="mb-2 h-10 w-full" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <Activity className="h-8 w-8 opacity-50" aria-hidden="true" />
                <p className="text-sm">
                  {user
                    ? 'No sessions saved yet — start tracking and press “Save session”.'
                    : 'No sessions yet — start tracking to record one.'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    {user && <TableHead className="text-xs">Patient</TableHead>}
                    <TableHead className="text-right text-xs">Reps</TableHead>
                    <TableHead className="text-right text-xs">Max°</TableHead>
                    <TableHead className="text-right text-xs">Comp</TableHead>
                    <TableHead className="text-right text-xs">Score</TableHead>
                    {user && <TableHead className="text-right text-xs">FHIR</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {user
                    ? v2Sessions.map((s) => (
                        <TableRow key={s.id} className="text-xs">
                          <TableCell className="whitespace-nowrap">
                            {formatDate(s.sessionDate)}
                          </TableCell>
                          <TableCell className="font-mono text-[10px]">
                            {s.patient?.name ?? s.patientId.slice(-6)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {s.totalReps}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {s.maxAchievedAngle.toFixed(0)}°
                          </TableCell>
                          <TableCell className="text-right font-mono text-rose-500">
                            {s.compensationErrors}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-emerald-500">
                            {s.gamificationScore}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[10px]"
                              onClick={() => handleViewFhir(s.id)}
                            >
                              <FileJson className="h-3 w-3" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    : v1Sessions
                        .slice()
                        .reverse()
                        .map((s) => (
                          <TableRow key={s.id} className="text-xs">
                            <TableCell className="whitespace-nowrap">
                              {formatDate(s.session_date)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {s.total_reps}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {s.max_achieved_angle}°
                            </TableCell>
                            <TableCell className="text-right font-mono text-rose-500">
                              {s.compensation_errors}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold text-emerald-500">
                              {s.gamification_score}
                            </TableCell>
                          </TableRow>
                        ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>

        {/* Aggregate stats + donut */}
        <Card className="lg:col-span-2">
          <div className="border-b border-border/60 p-3">
            <h3 className="text-sm font-semibold text-foreground">Aggregate Stats</h3>
          </div>
          <div className="p-4">
            {loading && !v2Stats && !v1Stats ? (
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Sessions" value={totalCount} accent="text-sky-400" />
                  <StatBox label="Total reps" value={totalReps} accent="text-primary" />
                  <StatBox label="Correct reps" value={totalCorrect} accent="text-emerald-500" />
                  <StatBox label="Total score" value={totalScore} accent="text-accent" />
                </div>
                <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="flex w-full items-center justify-between">
                    <span className="text-xs text-muted-foreground">Accuracy</span>
                    <span className="font-mono text-xl font-bold text-emerald-500">
                      {accuracy.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, accuracy)}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  {pieData.length > 0 && (
                    <div className="mt-2 flex w-full items-center gap-2">
                      <div className="h-24 w-24 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={28}
                              outerRadius={42}
                              paddingAngle={2}
                              stroke="none"
                            >
                              {pieData.map((d) => (
                                <Cell key={d.name} fill={d.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: 'rgba(15, 23, 42, 0.95)',
                                border: '1px solid rgba(148, 163, 184, 0.3)',
                                borderRadius: 6,
                                fontSize: 11,
                                color: '#e2e8f0',
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-col gap-1 text-xs">
                        {pieData.map((d) => (
                          <div key={d.name} className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ background: d.color }}
                              aria-hidden="true"
                            />
                            <span className="text-muted-foreground">{d.name}</span>
                            <span className="ml-auto font-mono font-semibold text-foreground">
                              {d.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Live snapshot readout (always useful — shows what would be saved). */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
        <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[10px]">
          <Loader2 className={cn('h-3 w-3', false && 'animate-spin')} />
          Live snapshot
        </Badge>
        <span className="text-xs text-muted-foreground">
          {currentSnapshot.repCount} reps · {currentSnapshot.correctReps} correct ·{' '}
          {currentSnapshot.score} pts · {currentSnapshot.maxAchievedAngle.toFixed(0)}° max ·{' '}
          {currentSnapshot.durationSeconds.toFixed(0)}s
        </span>
      </div>

      <FhirViewer
        sessionId={fhirSessionId}
        open={fhirOpen}
        onOpenChange={setFhirOpen}
      />
    </section>
  )
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card p-3')}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn('font-mono text-2xl font-bold tabular-nums', accent)}>
        {value.toLocaleString()}
      </span>
    </div>
  )
}
