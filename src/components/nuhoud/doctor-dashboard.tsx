'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Users,
  Activity,
  Target,
  Dumbbell,
  RotateCw,
  Search,
  CalendarClock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import type { V2PatientsResponse, V2PatientSummary, V2Stats } from '@/lib/v2-types'
import { GradientAvatar } from '@/components/nuhoud/gradient-avatar'
import { AnimatedKpi } from '@/components/nuhoud/animated-kpi'
import { ActivityHeatmap } from '@/components/nuhoud/activity-heatmap'
import { DoctorAnalytics } from '@/components/nuhoud/doctor-analytics'
import { ExerciseLibrary } from '@/components/nuhoud/exercise-library'
import { PrescribeFromPresetDialog } from '@/components/nuhoud/prescribe-from-preset-dialog'
import { PatientDetail } from '@/components/nuhoud/patient-detail'

interface DoctorDashboardProps {
  doctorId: string
}

function formatLatest(iso: string | null): string {
  if (!iso) return 'No sessions yet'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function accuracyOf(p: V2PatientSummary): number {
  if (!p.latestSession || p.latestSession.totalReps === 0) return 0
  return Math.round(
    (p.latestSession.correctReps / p.latestSession.totalReps) * 100,
  )
}

/**
 * DoctorDashboard — the doctor's main view.
 *
 * Top: 4 KPI tiles (total patients, total sessions today, avg accuracy across
 * patients, total reps this week) — animated count-up on mount.
 *
 * Patient roster: responsive card grid. Each card shows avatar, name, affected
 * side, sessions count, accuracy %, latest session date, and a "View" button.
 * Includes a search input for filtering by name/email.
 *
 * Click → switches to the PatientDetail view.
 */
export function DoctorDashboard({ doctorId }: DoctorDashboardProps) {
  const [patients, setPatients] = React.useState<V2PatientSummary[]>([])
  const [globalStats, setGlobalStats] = React.useState<V2Stats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [presetToPrescribe, setPresetToPrescribe] = React.useState<any | null>(null)
  const [presetDialogOpen, setPresetDialogOpen] = React.useState(false)

  const fetchRoster = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<V2PatientsResponse>('/api/v2/patients')
      setPatients(data.patients ?? [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load roster'
      toast.error('Roster load failed', { description: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchGlobal = React.useCallback(async () => {
    try {
      const data = await apiFetch<V2Stats>('/api/v2/stats')
      setGlobalStats(data)
    } catch {
      /* silent — KPIs degrade to 0 */
    }
  }, [])

  React.useEffect(() => {
    void fetchRoster()
    void fetchGlobal()
  }, [fetchRoster, fetchGlobal])

  // Filtered list (search by name/email).
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q),
    )
  }, [patients, search])

  // KPI aggregates (computed from the loaded roster).
  const kpis = React.useMemo(() => {
    const totalPatients = patients.length
    const todayIso = new Date().toISOString().slice(0, 10)
    const sessionsToday = patients.filter(
      (p) => p.latestSession && p.latestSession.sessionDate.slice(0, 10) === todayIso,
    ).length
    const accs = patients
      .map((p) => accuracyOf(p))
      .filter((a) => a > 0)
    const avgAcc = accs.length > 0 ? Math.round(accs.reduce((s, x) => s + x, 0) / accs.length) : 0
    const repsThisWeek = globalStats?.activity7d?.reduce((s, x) => s + x.reps, 0) ?? 0
    return { totalPatients, sessionsToday, avgAcc, repsThisWeek }
  }, [patients, globalStats])

  // Render patient detail when selected.
  if (selectedId) {
    return (
      <PatientDetail
        patientId={selectedId}
        onBack={() => setSelectedId(null)}
        onPlanCreated={() => {
          void fetchRoster()
          void fetchGlobal()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---------- KPI tiles ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AnimatedKpi
          value={kpis.totalPatients}
          label="Total patients"
          icon={Users}
          accent="primary"
        />
        <AnimatedKpi
          value={kpis.sessionsToday}
          label="Sessions today"
          icon={Activity}
          accent="emerald"
          hint="patients who trained today"
        />
        <AnimatedKpi
          value={kpis.avgAcc}
          label="Avg accuracy"
          icon={Target}
          accent="secondary"
          suffix="%"
          hint="across active patients"
        />
        <AnimatedKpi
          value={kpis.repsThisWeek}
          label="Reps this week"
          icon={Dumbbell}
          accent="primary"
          hint="last 7 days, all patients"
        />
      </div>

      {/* ---------- Activity heatmap (global across all patients) ---------- */}
      <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-5">
        <ActivityHeatmap weeks={12} title="Clinic activity · last 12 weeks (all patients)" />
      </Card>

      {/* ---------- Analytics: accuracy distribution + plan adherence ---------- */}
      <DoctorAnalytics />

      {/* ---------- Exercise library ---------- */}
      <ExerciseLibrary onPrescribe={(preset) => {
        setPresetToPrescribe(preset)
        setPresetDialogOpen(true)
      }} />

      {/* ---------- Roster ---------- */}
      <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Patient roster</h2>
            <p className="text-xs text-muted-foreground">
              {patients.length} patients · click any card to view the full clinical detail
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email…"
                className="h-9 w-56 pl-8 text-xs"
                aria-label="Search patients"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                void fetchRoster()
                void fetchGlobal()
              }}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {loading && patients.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 opacity-40" />
            <p className="text-sm">
              {search ? 'No patients match your search.' : 'No patients registered yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p, idx) => (
              <PatientCard
                key={p.id}
                patient={p}
                index={idx}
                onView={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Hidden prop reference to keep doctorId in the dependency graph */}
      <span className="sr-only" aria-hidden="true">
        Doctor ID: {doctorId}
      </span>

      {/* Prescribe-from-preset dialog (opened by ExerciseLibrary "Prescribe") */}
      <PrescribeFromPresetDialog
        preset={presetToPrescribe}
        patients={patients}
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        onPrescribed={() => {
          void fetchRoster()
          void fetchGlobal()
        }}
      />
    </div>
  )
}

function PatientCard({
  patient,
  index,
  onView,
}: {
  patient: V2PatientSummary
  index: number
  onView: () => void
}) {
  const acc = accuracyOf(patient)
  const accColor =
    acc >= 80
      ? 'text-emerald-500'
      : acc >= 50
        ? 'text-primary'
        : 'text-rose-500'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.3 }}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
    >
      <Card
        onClick={onView}
        tabIndex={0}
        role="button"
        aria-label={`View ${patient.name}'s clinical detail`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onView()
          }
        }}
        className="group flex h-full cursor-pointer flex-col gap-3 border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur transition-all hover:border-primary/50 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-3">
          <GradientAvatar
            seed={patient.avatarSeed}
            name={patient.name}
            size="h-10 w-10"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{patient.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {patient.email}
            </div>
            <Badge
              variant="outline"
              className={cn(
                'mt-1 gap-1 px-1.5 py-0 text-[9px] font-medium',
                patient.affectedSide === 'left'
                  ? 'border-secondary/40 text-secondary dark:text-slate-300'
                  : patient.affectedSide === 'bilateral'
                    ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                    : 'border-primary/40 text-primary dark:text-primary',
              )}
            >
              {patient.affectedSide === 'left'
                ? 'Left'
                : patient.affectedSide === 'bilateral'
                  ? 'Bilateral'
                  : 'Right'}{' '}
              affected
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-border/40 bg-muted/20 p-2">
            <div className="font-mono text-base font-bold text-primary">
              {patient.sessionsCount}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              sessions
            </div>
          </div>
          <div className="rounded-md border border-border/40 bg-muted/20 p-2">
            <div className={cn('font-mono text-base font-bold', accColor)}>
              {acc}%
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              accuracy
            </div>
          </div>
          <div className="rounded-md border border-border/40 bg-muted/20 p-2">
            <div className="font-mono text-base font-bold text-accent">
              {patient.plansCount}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              plans
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            {formatLatest(patient.latestSession?.sessionDate ?? null)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[10px] text-primary hover:text-primary dark:text-primary"
            onClick={(e) => {
              e.stopPropagation()
              onView()
            }}
          >
            View →
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}
