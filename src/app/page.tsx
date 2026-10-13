'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Header } from '@/components/nuhoud/header'
import {
  TrackingPanel,
  type TrackSnapshot,
} from '@/components/nuhoud/tracking-panel'
import { SessionHistory } from '@/components/nuhoud/session-history'
import { Footer } from '@/components/nuhoud/footer'
import { AuthScreen } from '@/components/nuhoud/auth-screen'
import { DoctorDashboard } from '@/components/nuhoud/doctor-dashboard'
import { PatientHeader } from '@/components/nuhoud/patient-header'
import { GoalsTracker } from '@/components/nuhoud/goals-tracker'
import { WeeklyInsights } from '@/components/nuhoud/weekly-insights'
import { ConfettiOverlay } from '@/components/nuhoud/confetti-overlay'
import { ActivityChart } from '@/components/nuhoud/activity-chart'
import { AgentChat } from '@/components/nuhoud/agent-chat'
import { Card } from '@/components/ui/card'
import { usePoseTracking } from '@/hooks/use-pose-tracking'
import { useAuth, AuthProvider } from '@/hooks/use-auth'
import { apiFetch } from '@/lib/api'
import type {
  V2PatientDetail,
  V2Stats,
} from '@/lib/v2-types'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { useTranslations, useLocale } from 'next-intl'

/**
 * SectionLabel — small uppercase muted label used as a divider between
 * major sections (per the styling polish spec: "01 · System Architecture",
 * "02 · Live Tracking").
 */
function SectionLabel({
  index,
  children,
}: {
  index: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] font-semibold tracking-widest text-primary uppercase">
        {index}
      </span>
      <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-border/60 to-transparent" />
    </div>
  )
}

/**
 * PatientDashboard — the authenticated patient's view. Combines the existing
 * tracking panel + JSON stream + history + biomechanics + API ref with the
 * new PatientHeader (active plan + daily-goal progress) and the 7-day
 * activity chart.
 */
function PatientDashboard() {
  const { user } = useAuth()
  const t = useTranslations('sections')
  const tp = useTranslations('patient')
  const ts = useTranslations('sessions')
  const locale = useLocale()
  const isRTL = locale === 'ar'
  const [goal, setGoal] = React.useState(20)
  const [snapshot, setSnapshot] = React.useState<TrackSnapshot>({
    mode: 'demo',
    running: false,
    durationSeconds: 0,
    repCount: 0,
    correctReps: 0,
    maxAchievedAngle: 0,
    compensationErrors: 0,
    score: 0,
    simulated: true,
  })
  // Bumps whenever a session is saved so SessionHistory re-fetches.
  const [sessionRefreshSignal, setSessionRefreshSignal] = React.useState(0)
  // Confetti celebration state — fires when a session save achieves a goal.
  const [celebrate, setCelebrate] = React.useState(false)
  const [celebrationMsg, setCelebrationMsg] = React.useState<{ headline: string; sub: string } | null>(null)

  // Patient detail (active plan + earned badges + sessions).
  const [detail, setDetail] = React.useState<V2PatientDetail | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(true)
  const [stats, setStats] = React.useState<V2Stats | null>(null)
  const [statsLoading, setStatsLoading] = React.useState(true)

  // Single shared pose-tracking instance — feeds the header connection
  // pill, the JSON stream panel and the tracking panel itself.
  // The patient_id is passed so the Python pose-server auto-syncs the
  // completed session to the Next.js DB on WS close (no manual Save needed).
  const pose = usePoseTracking({
    limb: 'right',
    target_angle: 90,
    compensation_threshold: 0.05,
    patient_id: user?.id,
  })

  const fetchDetail = React.useCallback(async () => {
    if (!user) return
    setDetailLoading(true)
    try {
      const data = await apiFetch<V2PatientDetail>(
        `/api/v2/patients/${user.id}`,
      )
      setDetail(data)
    } catch {
      /* silent */
    } finally {
      setDetailLoading(false)
    }
  }, [user])

  const fetchStats = React.useCallback(async () => {
    if (!user) return
    setStatsLoading(true)
    try {
      const data = await apiFetch<V2Stats>(
        `/api/v2/stats?patientId=${encodeURIComponent(user.id)}`,
      )
      setStats(data)
    } catch {
      /* silent */
    } finally {
      setStatsLoading(false)
    }
  }, [user])

  React.useEffect(() => {
    if (user) {
      void fetchDetail()
      void fetchStats()
    }
  }, [user, fetchDetail, fetchStats])

  // Edge-trigger WS-state toasts.
  const prevConn = React.useRef(pose.connection)
  React.useEffect(() => {
    if (prevConn.current === pose.connection) return
    prevConn.current = pose.connection
    if (pose.connection === 'Connected') {
      toast.success('تم الاتصال بخادم الاستدلال')
    } else if (pose.connection === 'Disconnected') {
      toast.info('انقطع الاتصال بخادم الاستدلال')
    }
  }, [pose.connection])

  const handleSnapshot = React.useCallback((s: TrackSnapshot) => {
    setSnapshot(s)
  }, [])

  const onSessionSaved = React.useCallback(
    (goalAchievements?: Array<{ title: string; currentValue: number; targetValue: number }>) => {
      void fetchDetail()
      void fetchStats()
      setSessionRefreshSignal((n) => n + 1)
      // Fire confetti if a goal was achieved this session.
      if (goalAchievements && goalAchievements.length > 0) {
        const g = goalAchievements[0]
        setCelebrationMsg({
          headline: 'تم تحقيق الهدف! 🎯',
          sub: `${g.title} — وصل إلى ${g.currentValue}${g.targetValue >= 100 ? '°' : ''}`,
        })
        setCelebrate(true)
      }
    },
    [fetchDetail, fetchStats],
  )

  // Today's reps (from activity7d's last entry, if today exists).
  const todayReps = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return stats?.activity7d?.find((d) => d.day === today)?.reps ?? 0
  }, [stats])

  return (
    <div className="nm-mesh-bg flex min-h-screen flex-col bg-background">
      <Header
        connection={pose.connection}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Card className="flex items-center justify-between gap-3 border-border/40 bg-card/70 p-5 shadow-sm">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {tp('score')}
              </span>
              <span className="font-mono text-3xl font-bold tracking-tight text-accent">
                {snapshot.score}
              </span>
              <span className="text-xs text-muted-foreground">{tp('yourSession')}</span>
            </div>
          </Card>
          <Card className="flex items-center justify-between gap-3 border-border/40 bg-card/70 p-5 shadow-sm">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {tp('repsToday')}
              </span>
              <span className="font-mono text-3xl font-bold tracking-tight text-primary">
                {todayReps}
              </span>
              <span className="text-xs text-muted-foreground">
                {tp('target')} {detail?.activePlan?.dailyRepGoal ?? goal}
              </span>
            </div>
          </Card>
        </motion.div>

        <PatientHeader
          plan={detail?.activePlan ?? null}
          todayReps={todayReps}
          stats={stats}
          loading={detailLoading}
        />

        <section className="flex flex-col gap-4">
          <SectionLabel index={isRTL ? '٠١' : '01'}>{t('liveTracking')}</SectionLabel>
          <TrackingPanel
            pose={pose}
            goal={goal}
            onGoalChange={setGoal}
            onTrackState={handleSnapshot}
            onSessionSaved={onSessionSaved}
          />
        </section>

        <section className="flex flex-col gap-5">
          <SectionLabel index={isRTL ? '٠٢' : '02'}>{t('progress')}</SectionLabel>
          <GoalsTracker />
          <WeeklyInsights />
          <Card className="border-border/40 bg-card/60 p-5 shadow-sm backdrop-blur">
            <ActivityChart data={stats?.activity7d ?? []} loading={statsLoading} />
          </Card>
        </section>

        <section className="flex flex-col gap-4 pb-4">
          <SectionLabel index={isRTL ? '٠٣' : '03'}>{ts('recentSessions')}</SectionLabel>
          <SessionHistory
            currentSnapshot={{
              repCount: snapshot.repCount,
              correctReps: snapshot.correctReps,
              maxAchievedAngle: snapshot.maxAchievedAngle,
              compensationErrors: snapshot.compensationErrors,
              score: snapshot.score,
              durationSeconds: snapshot.durationSeconds,
            }}
            refreshSignal={sessionRefreshSignal}
          />
        </section>
      </main>

      <AgentChat variant="compact" />
      <ConfettiOverlay
        active={celebrate}
        onDone={() => {
          setCelebrate(false)
          setCelebrationMsg(null)
        }}
        headline={celebrationMsg?.headline}
        subheadline={celebrationMsg?.sub}
      />
      <Footer rtl={isRTL} />
    </div>
  )
}

/**
 * DoctorView — the authenticated doctor's view. Wraps DoctorDashboard with
 * the standard header + footer chrome. Doctors have no live tracking panel
 * (they review patients, not their own rehab), so we don't mount the
 * pose-tracking hook here.
 */
function DoctorView() {
  const { user } = useAuth()
  const t = useTranslations('sections')
  const locale = useLocale()
  const isRTL = locale === 'ar'

  return (
    <div className="nm-mesh-bg flex min-h-screen flex-col bg-background">
      <Header
      />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <SectionLabel index={isRTL ? '٠١' : '01'}>{t('doctorDashboard')}</SectionLabel>
        {user && <DoctorDashboard doctorId={user.id} />}
      </main>
      <AgentChat variant="compact" />
      <Footer rtl={isRTL} />
    </div>
  )
}

/**
 * LoadingGate — spinner shown while the auth hook re-validates the persisted
 * JWT on first mount.
 */
function LoadingGate() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading Nuhoud…</p>
    </div>
  )
}

/**
 * Home — root route. Wraps the whole app in <AuthProvider> and routes
 * between the AuthScreen (unauthenticated), the patient dashboard, and the
 * doctor dashboard based on the authenticated user's role.
 */
export default function Home() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}

function Root() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingGate />
  if (!user) return <AuthScreen />
  if (user.role.toUpperCase() === 'DOCTOR' || user.role.toUpperCase() === 'ADMIN') {
    return <DoctorView />
  }
  return <PatientDashboard />
}
