'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Mail,
  Cake,
  Hand,
  Stethoscope,
  Plus,
  Loader2,
  FileJson,
  RotateCw,
  CalendarDays,
  Sparkles,
  Target,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { FhirBundleButton } from '@/components/nuhoud/fhir-bundle-button'
import { SetGoalDialog } from '@/components/nuhoud/set-goal-dialog'
import { GoalsTracker } from '@/components/nuhoud/goals-tracker'
import type {
  V2PatientDetail,
  V2Stats,
  V2CreatePlanPayload,
  V2TreatmentPlan,
} from '@/lib/v2-types'
import { GradientAvatar } from '@/components/nuhoud/gradient-avatar'
import { ActivityChart } from '@/components/nuhoud/activity-chart'
import { AccuracyDonut } from '@/components/nuhoud/accuracy-donut'
import { RomTrendChart } from '@/components/nuhoud/rom-trend-chart'
import { ActivityHeatmap } from '@/components/nuhoud/activity-heatmap'
import { CompTrendChart } from '@/components/nuhoud/comp-trend-chart'
import { LimbBreakdown } from '@/components/nuhoud/limb-breakdown'
import { ProgressTimeline } from '@/components/nuhoud/progress-timeline'
import { FhirViewer } from '@/components/nuhoud/fhir-viewer'

interface PatientDetailProps {
  patientId: string
  onBack: () => void
  /** Called after a plan is created so the parent can refresh its roster. */
  onPlanCreated?: () => void
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('en-GB', {
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

function ageFrom(dob: string | null | undefined): string {
  if (!dob) return '—'
  try {
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return '—'
    const diff = Date.now() - d.getTime()
    const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000))
    return years > 0 ? `${years} yrs` : '—'
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
  const [detail, setDetail] = React.useState<V2PatientDetail | null>(null)
  const [stats, setStats] = React.useState<V2Stats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [statsLoading, setStatsLoading] = React.useState(true)
  const [planDialogOpen, setPlanDialogOpen] = React.useState(false)
  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false)
  const [fhirSessionId, setFhirSessionId] = React.useState<string | null>(null)
  const [fhirOpen, setFhirOpen] = React.useState(false)
  const [coachOpen, setCoachOpen] = React.useState(false)

  const fetchDetail = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<V2PatientDetail>(`/api/v2/patients/${patientId}`)
      setDetail(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load patient'
      toast.error('Patient load failed', { description: msg })
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

  const handleViewFhir = (sessionId: string) => {
    setFhirSessionId(sessionId)
    setFhirOpen(true)
  }

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
          Back to roster
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
                    ? 'Left side affected'
                    : detail.patient.affectedSide === 'bilateral'
                      ? 'Bilateral'
                      : 'Right side affected'}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {detail.patient.email}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Cake className="h-3 w-3" />
                  {ageFrom(detail.patient.dateOfBirth)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {new Date(detail.patient.createdAt!).toLocaleDateString('en-GB', {
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
          Refresh
        </Button>
        <FhirBundleButton patientId={patientId} patientName={detail?.patient.name} days={30} />
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 border-accent/40 text-accent hover:bg-accent/5 dark:text-accent"
          onClick={() => setGoalDialogOpen(true)}
        >
          <Target className="h-3.5 w-3.5" />
          Set goal
        </Button>
        <Button
          size="sm"
          className={cn(
            'h-9 gap-1.5',
            coachOpen
              ? 'bg-rose-500 text-rose-50 hover:bg-rose-600'
              : 'bg-gradient-to-r from-primary to-emerald-600 text-white hover:from-primary hover:to-emerald-700',
          )}
          onClick={() => setCoachOpen((v) => !v)}
          aria-pressed={coachOpen}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {coachOpen ? 'Close coach' : 'Coach patient'}
        </Button>
      </div>

      {coachOpen && (
        <AgentChat patientId={patientId} patientName={detail?.patient.name} variant="embedded" />
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
                  Active treatment plan
                </span>
              </div>
              {detail?.activePlan ? (
                <>
                  <h3 className="text-base font-bold">
                    {detail.activePlan.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                      Target: <span className="font-mono font-semibold">{detail.activePlan.targetAngle}°</span>
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                      Sessions/wk: <span className="font-mono font-semibold">{detail.activePlan.sessionsPerWeek}</span>
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                      Daily goal: <span className="font-mono font-semibold">{detail.activePlan.dailyRepGoal}</span>
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal capitalize">
                      {detail.activePlan.targetLimb.replace('_', ' ')}
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
                  No active plan prescribed yet.
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-primary text-white hover:bg-primary"
              onClick={() => setPlanDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Prescribe new plan
            </Button>
          </div>
        )}
      </Card>

      {/* ---------- KPI row ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Total sessions" value={detail?.aggregate.totalSessions ?? 0} accent="text-sky-400" loading={loading} />
        <KpiTile label="Total reps" value={detail?.aggregate.totalReps ?? 0} accent="text-primary" loading={loading} />
        <KpiTile label="Max ROM" value={detail?.aggregate.maxAngleOverall ?? 0} suffix="°" accent="text-primary" loading={loading} />
        <KpiTile
          label="Accuracy"
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
              <h3 className="text-sm font-semibold">Accuracy</h3>
              <p className="text-[11px] text-muted-foreground">
                Correct vs compensated reps (last 30 sessions)
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
          title={`${detail?.patient.name ?? 'Patient'} · activity last 12 weeks`}
        />
      </Card>

      {/* ---------- Clinical trends: compensation trend + per-limb breakdown ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            <h3 className="text-sm font-semibold">Recent sessions</h3>
            <p className="text-[11px] text-muted-foreground">
              Last 50 sessions · FHIR R4 export available per row
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
                <p className="text-xs">No sessions recorded yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">Limb</TableHead>
                    <TableHead className="text-right text-xs">Reps</TableHead>
                    <TableHead className="text-right text-xs">Correct</TableHead>
                    <TableHead className="text-right text-xs">Max°</TableHead>
                    <TableHead className="text-right text-xs">Comp</TableHead>
                    <TableHead className="text-right text-xs">Score</TableHead>
                    <TableHead className="text-right text-xs">FHIR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.sessions.slice(0, 50).map((s) => (
                    <TableRow key={s.id} className="text-xs">
                      <TableCell className="whitespace-nowrap">
                        {formatDate(s.sessionDate)}
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
                          {s.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">{s.limb}</TableCell>
                      <TableCell className="text-right font-mono">{s.totalReps}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-500">{s.correctReps}</TableCell>
                      <TableCell className="text-right font-mono">{s.maxAchievedAngle.toFixed(0)}°</TableCell>
                      <TableCell className="text-right font-mono text-rose-500">{s.compensationErrors}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-accent">{s.gamificationScore}</TableCell>
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
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <FhirViewer
        sessionId={fhirSessionId}
        open={fhirOpen}
        onOpenChange={setFhirOpen}
      />

      {planDialogOpen && (
        <PrescribePlanDialog
          patientId={patientId}
          open={planDialogOpen}
          onOpenChange={setPlanDialogOpen}
          onCreated={(plan) => {
            toast.success('Plan prescribed', {
              description: `${plan.title} — target ${plan.targetAngle}°`,
            })
            setPlanDialogOpen(false)
            void fetchDetail()
            onPlanCreated?.()
          }}
        />
      )}

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

/**
 * PrescribePlanDialog — shadcn Dialog with a form to create a new
 * treatment plan: title, targetLimb select, targetAngle slider,
 * sessionsPerWeek, dailyRepGoal, notes.
 */
function PrescribePlanDialog({
  patientId,
  open,
  onOpenChange,
  onCreated,
}: {
  patientId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (plan: V2TreatmentPlan) => void
}) {
  const [title, setTitle] = React.useState('Upper-limb rehab plan')
  const [targetLimb, setTargetLimb] = React.useState('upper_right')
  const [targetAngle, setTargetAngle] = React.useState(90)
  const [sessionsPerWeek, setSessionsPerWeek] = React.useState(5)
  const [dailyRepGoal, setDailyRepGoal] = React.useState(20)
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const payload: V2CreatePlanPayload = {
        title: title.trim() || 'Upper-limb rehab plan',
        targetLimb,
        targetAngle,
        sessionsPerWeek,
        dailyRepGoal,
        notes: notes.trim() || undefined,
      }
      const data = await apiFetch<{ ok: boolean; plan: V2TreatmentPlan }>(
        `/api/v2/patients/${patientId}/plans`,
        { method: 'POST', json: payload },
      )
      if (!data.ok) throw new Error('server rejected payload')
      onCreated(data.plan)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to prescribe plan'
      toast.error('Prescription failed', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prescribe a new treatment plan</DialogTitle>
          <DialogDescription>
            The previous active plan (if any) will be deactivated
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-title">Title</Label>
            <Input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Upper-limb rehab plan"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Target limb</Label>
            <Select value={targetLimb ?? ''} onValueChange={setTargetLimb}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upper_right">Right upper limb</SelectItem>
                <SelectItem value="upper_left">Left upper limb</SelectItem>
                <SelectItem value="bilateral">Bilateral</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <Label htmlFor="plan-angle">Target angle</Label>
              <span className="font-mono font-semibold text-primary">{targetAngle}°</span>
            </div>
            <Slider
              id="plan-angle"
              value={[targetAngle]}
              min={0}
              max={180}
              step={5}
              onValueChange={(v) => setTargetAngle(v[0])}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-spw">Sessions / week</Label>
              <Input
                id="plan-spw"
                type="number"
                min={1}
                max={14}
                value={sessionsPerWeek}
                onChange={(e) => setSessionsPerWeek(Number(e.target.value) || 5)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-daily">Daily rep goal</Label>
              <Input
                id="plan-daily"
                type="number"
                min={1}
                max={200}
                value={dailyRepGoal}
                onChange={(e) => setDailyRepGoal(Number(e.target.value) || 20)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-notes">Clinical notes</Label>
            <Textarea
              id="plan-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional guidance for the patient…"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="gap-1.5 bg-primary text-white hover:bg-primary"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Prescribe plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// End of PatientDetail.

