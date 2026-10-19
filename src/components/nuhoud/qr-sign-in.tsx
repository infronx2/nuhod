'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Loader2, ScanFace, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NeuronMark } from '@/components/nuhoud/neuron-mark'
import { useAuth } from '@/hooks/use-auth'
import { apiFetch } from '@/lib/api'
import { addPasskey, passkeysSupported } from '@/lib/passkey-client'
import type { V2User } from '@/lib/v2-types'

type Step = 'signing' | 'offer-face' | 'adding' | 'done' | 'failed'

/**
 * Signs the patient in with the one-time code from the doctor's QR, then offers Face ID /
 * fingerprint so the next sign-in on this phone needs no code and no PIN.
 */
export function QrSignIn() {
  const t = useTranslations('mvp')
  const { acceptSignIn } = useAuth()
  const [step, setStep] = React.useState<Step>('signing')
  const [name, setName] = React.useState('')
  const started = React.useRef(false)

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    const token = window.location.hash.slice(1)
    // Drop the code from the address bar and history right away.
    window.history.replaceState(null, '', '/q')
    apiFetch<{ token: string; user: V2User }>('/api/v2/auth/qr', { method: 'POST', noAuth: true, json: { token } })
      .then((data) => {
        acceptSignIn(data)
        setName(data.user.name.split(' ')[0])
        setStep(passkeysSupported() ? 'offer-face' : 'done')
      })
      .catch(() => setStep('failed'))
  }, [acceptSignIn])

  React.useEffect(() => {
    if (step === 'done') {
      const id = setTimeout(() => window.location.replace('/'), 1500)
      return () => clearTimeout(id)
    }
  }, [step])

  const enableFace = async () => {
    setStep('adding')
    try { await addPasskey() } catch { /* they can add it later from the home page */ }
    setStep('done')
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[#0B3E46] p-6 text-white">
      <div className="w-full max-w-sm rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-7 text-center shadow-2xl">
        <NeuronMark className="mx-auto h-12 w-12 text-[#7FD8DE]" />
        {step === 'signing' && (
          <p className="mt-6 flex items-center justify-center gap-2 text-lg"><Loader2 className="h-5 w-5 animate-spin" /> {t('qrSigning')}</p>
        )}
        {step === 'offer-face' && (
          <>
            <p className="mt-5 text-xl font-semibold">{t('qrWelcome', { name })}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/75">{t('faceOffer')}</p>
            <Button onClick={() => void enableFace()} className="mt-6 h-14 w-full gap-2 rounded-2xl bg-white text-lg font-semibold text-[#0B3E46] hover:bg-[#E2F3F1]">
              <ScanFace className="h-5 w-5" /> {t('faceEnable')}
            </Button>
            <button type="button" onClick={() => setStep('done')} className="mt-4 text-sm text-white/60 underline-offset-4 hover:underline">{t('later')}</button>
          </>
        )}
        {step === 'adding' && <p className="mt-6 flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> {t('faceAdding')}</p>}
        {step === 'done' && <p className="mt-6 flex items-center justify-center gap-2 text-lg"><CheckCircle2 className="h-5 w-5 text-[#7FD8DE]" /> {t('qrDone')}</p>}
        {step === 'failed' && (
          <>
            <p className="mt-6 flex items-center justify-center gap-2 text-lg font-semibold"><TriangleAlert className="h-5 w-5 text-amber-300" /> {t('qrFailed')}</p>
            <p className="mt-2 text-sm text-white/75">{t('qrFailedHelp')}</p>
            <Button asChild variant="outline" className="mt-6 h-12 w-full border-white/25 bg-transparent text-white hover:bg-white/10"><a href="/">{t('toSignIn')}</a></Button>
          </>
        )}
      </div>
    </div>
  )
}
