'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Header } from '@/components/nuhoud/header'
import { Footer } from '@/components/nuhoud/footer'
import { AuthScreen } from '@/components/nuhoud/auth-screen'
import { DoctorDashboard } from '@/components/nuhoud/doctor-dashboard'
import { PatientHome } from '@/components/nuhoud/patient-home'
import { AgentChat } from '@/components/nuhoud/agent-chat'
import { useAuth, AuthProvider } from '@/hooks/use-auth'
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
 * PatientDashboard — the patient's view: a single page built around starting today's majlis
 * session (see PatientHome), with the AI coach one tap away.
 */
function PatientDashboard() {
  const locale = useLocale()
  const isRTL = locale === 'ar'

  return (
    <div className="nm-mesh-bg flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <PatientHome />
      </main>
      <AgentChat variant="compact" />
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
