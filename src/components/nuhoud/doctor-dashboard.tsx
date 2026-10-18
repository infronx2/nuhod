'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Users, Activity, TriangleAlert, Dumbbell } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import type { V2PatientsResponse, V2PatientSummary, V2Stats } from '@/lib/v2-types'
import { AnimatedKpi } from '@/components/nuhoud/animated-kpi'
import { ActivityHeatmap } from '@/components/nuhoud/activity-heatmap'
import { DoctorAnalytics } from '@/components/nuhoud/doctor-analytics'
import { ExerciseLibrary } from '@/components/nuhoud/exercise-library'
import { PrescribeFromPresetDialog } from '@/components/nuhoud/prescribe-from-preset-dialog'
import { PatientDetail } from '@/components/nuhoud/patient-detail'
import { PatientRosterTable } from '@/components/nuhoud/patient-roster-table'
import { PlanEditorDialog } from '@/components/nuhoud/plan-editor-dialog'

interface DoctorDashboardProps {
  doctorId: string
}

/**
 * DoctorDashboard — the doctor's main view.
 *
 * Top: KPI tiles. Then the patient roster table (patients needing attention first), where each
 * row opens the patient's detail or the plan editor. Clinic-wide analytics and the exercise
 * library follow below.
 */
export function DoctorDashboard({ doctorId: _doctorId }: DoctorDashboardProps) {
  const tu = useTranslations('ui')
  const t = useTranslations('doctor')
  const [patients, setPatients] = React.useState<V2PatientSummary[]>([])
  const [globalStats, setGlobalStats] = React.useState<V2Stats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [planPatient, setPlanPatient] = React.useState<V2PatientSummary | null>(null)
  const [planOpen, setPlanOpen] = React.useState(false)
  const [presetToPrescribe, setPresetToPrescribe] = React.useState<any | null>(null)
  const [presetDialogOpen, setPresetDialogOpen] = React.useState(false)

  const fetchRoster = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<V2PatientsResponse>('/api/v2/patients')
      setPatients(data.patients ?? [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load roster'
      toast.error(tu('rosterFailed'), { description: msg })
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

  const refresh = React.useCallback(() => {
    void fetchRoster()
    void fetchGlobal()
  }, [fetchRoster, fetchGlobal])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const kpis = React.useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    return {
      totalPatients: patients.length,
      sessionsToday: patients.filter((p) => p.latestSession?.sessionDate.slice(0, 10) === todayIso).length,
      attention: patients.filter((p) => p.indicators?.status === 'attention').length,
      repsThisWeek: globalStats?.activity7d?.reduce((s, x) => s + x.reps, 0) ?? 0,
    }
  }, [patients, globalStats])

  if (selectedId) {
    return (
      <PatientDetail
        patientId={selectedId}
        onBack={() => setSelectedId(null)}
        onPlanCreated={refresh}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AnimatedKpi value={kpis.totalPatients} label={t('totalPatients')} icon={Users} accent="primary" />
        <AnimatedKpi
          value={kpis.sessionsToday}
          label={t('sessionsToday')}
          icon={Activity}
          accent="emerald"
          hint={t('hintTrainedToday')}
        />
        <AnimatedKpi
          value={kpis.attention}
          label={t('needAttention')}
          icon={TriangleAlert}
          accent="secondary"
          hint={t('hintAttention')}
        />
        <AnimatedKpi
          value={kpis.repsThisWeek}
          label={t('repsThisWeek')}
          icon={Dumbbell}
          accent="primary"
          hint={t('hintWeek')}
        />
      </div>

      <PatientRosterTable
        patients={patients}
        loading={loading}
        onView={setSelectedId}
        onEditPlan={(patient) => {
          setPlanPatient(patient)
          setPlanOpen(true)
        }}
        onRefresh={refresh}
      />

      <DoctorAnalytics />

      <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-5">
        <ActivityHeatmap weeks={12} title={t('clinicActivity')} />
      </Card>

      <ExerciseLibrary
        onPrescribe={(preset) => {
          setPresetToPrescribe(preset)
          setPresetDialogOpen(true)
        }}
      />

      <PlanEditorDialog
        patient={planPatient}
        plan={planPatient?.activePlan ?? null}
        open={planOpen}
        onOpenChange={setPlanOpen}
        onSaved={refresh}
      />

      <PrescribeFromPresetDialog
        preset={presetToPrescribe}
        patients={patients}
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        onPrescribed={refresh}
      />
    </div>
  )
}
