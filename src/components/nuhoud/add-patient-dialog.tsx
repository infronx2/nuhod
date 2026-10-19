'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch } from '@/lib/api'
import { PatientCredentials, type IssuedCredentials } from '@/components/nuhoud/patient-credentials'

/** Eligibility for the trial; a draft list for the clinical team to adjust. */
export const SCREENING_ITEMS = ['stroke', 'stable', 'sits', 'follows', 'vision', 'noSeizure', 'shoulder'] as const

/**
 * Doctor → Add patient: who, which side, written consent recorded, eligibility confirmed. The new
 * account is linked to this doctor, gets a starter plan, and the doctor gets the sign-in card.
 */
export function AddPatientDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void }) {
  const t = useTranslations('mvp')
  const [name, setName] = React.useState('')
  const [side, setSide] = React.useState<'right' | 'left' | 'bilateral'>('right')
  const [dob, setDob] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [consent, setConsent] = React.useState(false)
  const [screen, setScreen] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)
  const [issued, setIssued] = React.useState<IssuedCredentials | null>(null)

  const reset = () => { setName(''); setSide('right'); setDob(''); setUsername(''); setConsent(false); setScreen({}); setIssued(null) }
  const allScreened = SCREENING_ITEMS.every((k) => screen[k])
  const ready = name.trim() && consent && allScreened

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      const res = await apiFetch<{ patient: { name: string; username: string }; pin: string; qrToken: string; qrExpiresAt: string }>('/api/v2/patients', {
        method: 'POST',
        json: { name: name.trim(), affectedSide: side, dateOfBirth: dob || undefined, username: username.trim() || undefined, consentSigned: true, screening: screen },
      })
      setIssued({ name: res.patient.name, username: res.patient.username, pin: res.pin, qrToken: res.qrToken, qrExpiresAt: res.qrExpiresAt })
      onAdded()
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 409 ? t('usernameTaken') : t('addFailed'))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{issued ? t('addedTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{issued ? t('addedPrompt') : t('addPrompt')}</DialogDescription>
        </DialogHeader>
        {issued ? (
          <PatientCredentials creds={issued} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ap-name">{t('patientName')}</Label>
              <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('affectedSide')}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['right', 'left', 'bilateral'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSide(s)} className={cn('h-10 rounded-md border text-sm', side === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                    {t(`side_${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ap-dob">{t('dob')}</Label>
                <Input id="ap-dob" type="date" dir="ltr" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ap-user">{t('usernameOptional')}</Label>
                <Input id="ap-user" dir="ltr" placeholder="nh1234" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
              </div>
            </div>
            <fieldset className="flex flex-col gap-2 rounded-xl border border-border/60 p-3">
              <legend className="px-1 text-sm font-semibold">{t('screeningTitle')}</legend>
              {SCREENING_ITEMS.map((k) => (
                <label key={k} className="flex items-start gap-2 text-sm leading-snug">
                  <Checkbox checked={!!screen[k]} onCheckedChange={(v) => setScreen((s) => ({ ...s, [k]: v === true }))} className="mt-0.5" />
                  {t(`screen_${k}`)}
                </label>
              ))}
            </fieldset>
            <label className="flex items-start gap-2 rounded-xl bg-primary/5 p-3 text-sm font-medium leading-snug">
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
              {t('consentSigned')}
            </label>
            <Button type="submit" disabled={!ready || busy} className="h-11 gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t('addBtn')}
            </Button>
            {!allScreened && <p className="text-xs text-muted-foreground">{t('screeningNote')}</p>}
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
