'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  ArrowLeft,
  Mail,
  Cake,
  Hand,
  Stethoscope,
  Pencil,
  FileJson,
  RotateCw,
  CalendarDays,
  Sparkles,
  Target,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { AgentChat } from '@/components/nuhoud/agent-chat'
import { SetGoalDialog } from '@/components/nuhoud/set-goal-dialog'
import { GoalsTracker } from '@/components/nuhoud/goals-tracker'
import type {
  V2PatientDetail,
  V2Stats,
} from '@/lib/v2-types'
import { GradientAvatar } from '@/components/nuhoud/gradient-avatar'
import { ActivityChart } from '@/components/nuhoud/activity-chart'
import { AccuracyDonut } from '@/components/nuhoud/accuracy-donut'
import { RomTrendChart } from '@/components/nuhoud/rom-trend-chart'
import { GripTrendChart } from '@/components/nuhoud/grip-trend-chart'
import { PlanEditorDialog } from '@/components/nuhoud/plan-editor-dialog'
import { ActivityHeatmap } from '@/components/nuhoud/activity-heatmap'
import { CompTrendChart } from '@/components/nuhoud/comp-trend-chart'
import { LimbBreakdown } from '@/components/nuhoud/limb-breakdown'
import { ProgressTimeline } from '@/components/nuhoud/progress-timeline'

interface PatientDetailProps {
  patientId: string
  onBack: () => void
  /** Called after a plan is created so the parent can refresh its roster. */
  onPlanCreated?: () => void
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(locale === 'ar' ? 'ar-OM' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function ageFrom(dob: string | null | undefined, fmt: (n: number) => string): string {
  if (!dob) return '—'
  try {
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return '—'
    const diff = Date.now() - d.getTime()
    const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000))
    return years > 0 ? fmt(years) : '—'
  } catch {
    return '—'
  }
}

/**
 * PatientDetail — full clinical view of one patient.
 *
 * Header: avatar, name, age (from dateOfBirth), affected side, email,
 * "Back to roster" button.
 *
 * Active plan card with "Prescribe new plan" button (opens Dialog with a
 * form: title, targetLimb select, targetAngle slider, sessionsPerWeek,
 * dailyRepGoal, notes).
 *
 * 3-up chart row: activity-chart, accuracy-donut, rom-trend-chart.
 *
 * Badges panel.
 *
 * Recent sessions table with per-row "View FHIR" button.
 */
export function PatientDetail({ patientId, onBack, onPlanCreated }: PatientDetailProps) {
  const tr = useTranslations('roster')
  const td = useTranslations('doctor')
  const t = useTranslations('pd')
  const locale = useLocale()
  const sourceLabel = (src: string) => (src === 'ue5-vr' ? t('srcVr') : src.startsWith('ue') ? t('srcGame') : src === 'web' ? t('srcWeb') : src === 'live' ? t('srcLive') : src)
  const limbLabel = (l: string) => (l === 'left' ? t('limbLeft') : l === 'bilateral' ? t('limbBoth') : t('limbRight'))
  const [detail, setDetail] = React.useState<V2PatientDetail | null>(null)
  const [stats, setStats] = React.useState<V2Stats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [statsLoading, setStatsLoading] = React.useState(true)
  const [planDialogOpen, setPlanDialogOpen] = React.useState(false)
  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false)
  const [coachOpen, setCoachOpen] = React.useState(false)

  const fetchDetail = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<V2PatientDetail>(`/api/v2/patients/${patientId}`)
      setDetail(data)
    } catch (err) {
      toast.error(t('loadFailed'), { description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoading(false)
    }
  }, [patientId])

  const fetchStats = React.useCallback(async () => {
    setStatsLoading(true)
    try {
      const data = await apiFetch<V2Stats>(
        `/api/v2/stats?patientId=${encodeURIComponent(patientId)}`,
      )
      setStats(data)
    } catch {
      /* keep previous stats */
    } finally {
      setStatsLoading(false)
    }
  }, [patientId])

  React.useEffect(() => {
    void fetchDetail()
    void fetchStats()
  }, [fetchDetail, fetchStats])

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Header ---------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('back')}
        </Button>
        {loading ? (
          <div className="flex flex-1 items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ) : detail ? (
          <div className="flex flex-1 items-center gap-3">
            <GradientAvatar
              seed={detail.patient.avatarSeed}
              name={detail.patient.name}
              size="h-12 w-12"
            />
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">
                  {detail.patient.name}
                </h2>
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1 px-2 py-0.5 text-[10px] font-medium',
                    detail.patient.affectedSide === 'left'
                      ? 'border-secondary/40 text-secondary dark:text-slate-300'
                      : detail.patient.affectedSide === 'bilateral'
                        ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                        : 'border-primary/40 text-primary dark:text-primary',
                  )}
                >
                  <Hand className="h-3 w-3" />
                  {detail.patient.affectedSide === 'left'
                    ? t('leftSide')
                    : detail.patient.affectedSide === 'bilateral'
                      ? t('bilateral')
                      : t('rightSide')}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {detail.patient.email}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Cake className="h-3 w-3" />
                  {ageFrom(detail.patient.dateOfBirth, (n) => t('years', { n }))}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {new Date(detail.patient.createdAt!).toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => {
            void fetchDetail()
            void fetchStats()
          }}
        >
          <RotateCw className="h-3.5 w-3.5" />
          {t('refresh')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 border-accent/40 text-accent hover:bg-accent/5 dark:text-accent"
          onClick={() => setGoalDialogOpen(true)}
        >
          <Target className="h-3.5 w-3.5" />
          {t('setGoal')}
        </Button>
        <Button
          size="sm"
          className={cn(
            'h-9 gap-1.5',
            coachOpen
              ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
          onClick={() => setCoachOpen((v) => !v)}
          aria-pressed={coachOpen}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {coachOpen ? td('closeCoach') : td('coachPatient')}
        </Button>
      </div>

      {coachOpen && (
        <AgentChat
          patientId={patientId}
          patientName={detail?.patient.name}
          variant="embedded"
          onPlanApplied={() => {
            void fetchDetail()
            onPlanCreated?.()
          }}
        />
      )}

      {/* ---------- Active plan card ---------- */}
      <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-6">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-primary dark:text-primary">
                  {t('activePlan')}
                </span>
              </div>
              {detail?.activePlan ? (
                <>
                  <h3 className="text-base font-bold">
                    {detail.activePlan.title === 'Upper-limb rehab plan' ? t('defaultPlanTitle') : detail.activePlan.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                      {t('target')}: <span className="font-mono font-semibold">{detail.activePlan.targetAngle}°</span>
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                      {t('sessionsWk')}: <span className="font-mono font-semibold">{detail.activePlan.sessionsPerWeek}</span>
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                      {t('dailyGoal')}: <span className="font-mono font-semibold">{detail.activePlan.dailyRepGoal}</span>
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal capitalize">
                      {limbLabel(detail.activePlan.targetLimb.replace('upper_', ''))}
                    </Badge>
                  </div>
                  {detail.activePlan.notes && (
                    <p className="mt-1 max-w-2xl rounded-md border border-border/40 bg-muted/20 p-2 text-xs text-muted-foreground">
                      {detail.activePlan.notes}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('noPlan')}
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-primary text-white hover:bg-primary"
              onClick={() => setPlanDialogOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {tr('editPlan')}
            </Button>
          </div>
        )}
      </Card>

      {/* ---------- KPI row ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label={t('totalSessions')} value={detail?.aggregate.totalSessions ?? 0} accent="text-sky-400" loading={loading} />
        <KpiTile label={t('totalReps')} value={detail?.aggregate.totalReps ?? 0} accent="text-primary" loading={loading} />
        <KpiTile label={t('maxRom')} value={detail?.aggregate.maxAngleOverall ?? 0} suffix="°" accent="text-primary" loading={loading} />
        <KpiTile
          label={t('accuracy')}
          value={detail?.aggregate.accuracyPct ?? 0}
          suffix="%"
          accent="text-emerald-500"
          loading={loading}
        />
      </div>

      {/* ---------- 3-up chart row ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur">
          <ActivityChart data={stats?.activity7d ?? []} loading={statsLoading} />
        </Card>
        <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="text-sm font-semibold">{t('accuracy')}</h3>
              <p className="text-[11px] text-muted-foreground">
                {t('accuracyDesc')}
              </p>
            </div>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="flex items-center justify-center py-2">
                <AccuracyDonut
                  correctReps={detail?.aggregate.totalCorrectReps ?? 0}
                  compensatedReps={Math.max(
                    0,
                    (detail?.aggregate.totalReps ?? 0) -
                      (detail?.aggregate.totalCorrectReps ?? 0),
                  )}
                  accuracyPct={detail?.aggregate.accuracyPct}
                />
              </div>
            )}
          </div>
        </Card>
        <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur">
          <RomTrendChart
            sessions={detail?.sessions ?? []}
            loading={loading}
            targetAngle={detail?.activePlan?.targetAngle}
          />
        </Card>
      </div>

      {/* ---------- Per-patient activity heatmap ---------- */}
      <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-5">
        <ActivityHeatmap
          patientId={patientId}
          weeks={12}
          title={t('activity12w', { name: detail?.patient.name ?? '' })}
        />
      </Card>

      {/* ---------- Clinical trends: compensation trend + per-limb breakdown ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur">
          <GripTrendChart sessions={detail?.sessions ?? []} loading={loading} />
        </Card>
        <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur">
          <CompTrendChart sessions={detail?.sessions ?? []} loading={loading} />
        </Card>
        <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur">
          <LimbBreakdown sessions={detail?.sessions ?? []} loading={loading} />
        </Card>
      </div>

      {/* ---------- Progress timeline (milestone narrative) ---------- */}
      <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-5">
        <ProgressTimeline patientId={patientId} loading={loading} />
      </Card>

      {/* ---------- Goals tracker (with delete for doctors) ---------- */}
      <GoalsTracker patientId={patientId} />

      {/* ---------- Sessions table ---------- */}
      <div className="grid grid-cols-1 gap-4">
        <Card className="border-border/40 bg-card/60 shadow-sm backdrop-blur">
          <div className="border-b border-border/60 p-3">
            <h3 className="text-sm font-semibold">{t('recentSessions')}</h3>
            <p className="text-[11px] text-muted-foreground">
              {t('last50')}
            </p>
          </div>
          <div className="nm-scroll-thin max-h-96 overflow-auto">
            {loading ? (
              <div className="p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="mb-2 h-9 w-full" />
                ))}
              </div>
            ) : !detail || detail.sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <CalendarDays className="h-8 w-8 opacity-40" />
                <p className="text-xs">{t('noSessions')}</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="text-xs">{t('date')}</TableHead>
                    <TableHead className="text-xs">{t('source')}</TableHead>
                    <TableHead className="text-xs">{t('limb')}</TableHead>
                    <TableHead className="text-end text-xs">{t('reps')}</TableHead>
                    <TableHead className="text-end text-xs">{t('correct')}</TableHead>
                    <TableHead className="text-end text-xs">{t('maxDeg')}</TableHead>
                    <TableHead className="text-end text-xs">{t('grip')}</TableHead>
                    <TableHead className="text-end text-xs">{t('pinch')}</TableHead>
                    <TableHead className="text-end text-xs">{t('comp')}</TableHead>
                    <TableHead className="text-end text-xs">{t('score')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.sessions.slice(0, 50).map((s) => (
                    <TableRow key={s.id} className="text-xs">
                      <TableCell className="whitespace-nowrap">
                        {formatDate(s.sessionDate, locale)}
                        {s.painStop && (
                          <Badge variant="destructive" className="ml-1.5 px-1 py-0 text-[9px]">
                            {t('painStop')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="capitalize">
                        <Badge
                          variant="outline"
                          className={cn(
                            'px-1.5 py-0 text-[9px] font-medium',
                            s.source === 'live'
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                              : 'border-secondary/40 text-secondary dark:text-slate-300',
                          )}
                        >
                          {sourceLabel(s.source)}
                        </Badge>
                      </TableCell>
                      <TableCell>{limbLabel(s.limb)}</TableCell>
                      <TableCell className="text-end font-mono">{s.totalReps}</TableCell>
                      <TableCell className="text-end font-mono text-emerald-500">{s.correctReps}</TableCell>
                      <TableCell className="text-end font-mono">{s.maxAchievedAngle.toFixed(0)}°</TableCell>
                      <TableCell className="text-end font-mono">
                        {s.gripClosureMax ? `${s.gripClosureMax.toFixed(0)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {s.pinchMinCm ? t('cm', { n: s.pinchMinCm.toFixed(1) }) : '—'}
                      </TableCell>
                      <TableCell className="text-end font-mono text-rose-500">{s.compensationErrors}</TableCell>
                      <TableCell className="text-end font-mono font-semibold text-accent">{s.gamificationScore}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>


      <PlanEditorDialog
        patient={detail ? { id: patientId, name: detail.patient.name, affectedSide: detail.patient.affectedSide } : null}
        plan={detail?.activePlan ?? null}
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        onSaved={() => {
          void fetchDetail()
          onPlanCreated?.()
        }}
      />

      <SetGoalDialog
        patientId={patientId}
        patientName={detail?.patient.name}
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        onCreated={() => {
          void fetchDetail()
          void fetchStats()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function KpiTile({
  label,
  value,
  suffix = '',
  accent,
  loading,
}: {
  label: string
  value: number
  suffix?: string
  accent: string
  loading?: boolean
}) {
  return (
    <Card className="border-border/40 bg-card/60 p-3 shadow-sm backdrop-blur">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-16" />
      ) : (
        <div className={cn('font-mono text-2xl font-bold tabular-nums', accent)}>
          {value.toLocaleString()}
          {suffix}
        </div>
      )}
    </Card>
  )
}
