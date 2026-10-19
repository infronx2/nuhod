'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { apiFetch } from '@/lib/api'

/**
 * The information screen a patient reads and agrees to once, on their first sign-in, before any
 * session (the written consent form is signed with the doctor; this is its short in-app twin).
 * The wording is a draft for the ethics committee to review.
 */
export function PatientConsent({ children }: { children: React.ReactNode }) {
  const t = useTranslations('mvp')
  const { user, refresh } = useAuth()
  const [busy, setBusy] = React.useState(false)
  if (!user || user.role !== 'PATIENT' || user.patientConsentAt) return <>{children}</>

  const agree = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/v2/me/consent', { method: 'POST' })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const points = ['consentWhat', 'consentData', 'consentWho', 'consentSafety', 'consentFree'] as const
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></span>
        <h1 className="text-xl font-semibold">{t('consentTitle')}</h1>
      </div>
      <ul className="flex flex-col gap-3 text-[15px] leading-relaxed">
        {points.map((k) => (
          <li key={k} className="rounded-2xl border border-border/50 bg-card/70 p-4">{t(k)}</li>
        ))}
      </ul>
      <Button onClick={() => void agree()} disabled={busy} className="h-14 rounded-2xl text-lg font-semibold">
        {busy && <Loader2 className="h-5 w-5 animate-spin" />} {t('consentAgree')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('consentNotAgree')}</p>
    </div>
  )
}
