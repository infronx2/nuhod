'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Loader2, LogIn, Eye, EyeOff, ScanFace, Shield, UserRound, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { ApiError } from '@/lib/api'
import { signInWithPasskey, usePasskeysSupported } from '@/lib/passkey-client'
import { AuthHero } from '@/components/nuhoud/auth-hero'
import { NeuronMark } from '@/components/nuhoud/neuron-mark'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Sign-in. Patients (added by their doctor) use a username and a 6-digit PIN, Face ID / fingerprint
 * once set up, or the QR code the doctor shows them (handled on /q). Staff use email and password;
 * a new doctor account needs the clinic's invite code.
 */
export function AuthScreen() {
  const { login, register, acceptSignIn } = useAuth()
  const t = useTranslations('auth')
  const tm = useTranslations('mvp')
  const tc = useTranslations('common')
  const [tab, setTab] = React.useState<'patient' | 'staff'>('patient')
  const [busy, setBusy] = React.useState(false)
  const canPasskey = usePasskeysSupported()

  const [username, setUsername] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPw, setShowPw] = React.useState(false)
  const [newDoctor, setNewDoctor] = React.useState(false)
  const [regName, setRegName] = React.useState('')
  const [regInvite, setRegInvite] = React.useState('')

  const failed = (err: unknown) => {
    const status = err instanceof ApiError ? err.status : 0
    const body = err instanceof ApiError ? (err.body as { retryAfterMinutes?: number } | null) : null
    if (status === 429) toast.error(tm('locked', { minutes: body?.retryAfterMinutes ?? 15 }))
    else if (status === 403) toast.error(tm('disabled'))
    else toast.error(t('invalidCredentials'))
  }

  const welcome = (name: string) => toast.success(t('welcomeToast', { name: name.split(' ')[0] }))

  const patientLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!username.trim() || !/^\d{6}$/.test(pin)) { toast.error(tm('pinFormat')); return }
    setBusy(true)
    try { welcome((await login(username.trim().toLowerCase(), pin)).name) } catch (err) { failed(err) } finally { setBusy(false) }
  }

  const staffLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const em = email.trim().toLowerCase()
    if (!EMAIL_RE.test(em) || !password) { toast.error(t('invalidCredentials')); return }
    setBusy(true)
    try {
      if (newDoctor) {
        if (!regName.trim() || password.length < 6) { toast.error(t('passwordTooShort')); return }
        welcome((await register({ email: em, name: regName.trim(), password, role: 'DOCTOR', inviteCode: regInvite.trim() })).name)
      } else {
        welcome((await login(em, password)).name)
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      if (newDoctor) toast.error(status === 409 ? t('emailTaken') : status === 403 ? t('inviteRequired') : t('registerFailed'))
      else failed(err)
    } finally { setBusy(false) }
  }

  const faceLogin = async () => {
    setBusy(true)
    try { welcome(acceptSignIn(await signInWithPasskey()).name) } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') return // the patient closed the Face ID prompt
      toast.error(tm('faceFailed'))
    } finally { setBusy(false) }
  }

  return (
    <div className="nm-mesh-bg grid min-h-screen w-full grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthHero />
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="text-primary"><NeuronMark className="h-9 w-9" /></div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight">{tc('appName')}</span>
              <span className="text-[10px] text-muted-foreground">{t('heroHighlight')}</span>
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'patient' | 'staff')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="patient" className="gap-1.5"><UserRound className="h-3.5 w-3.5" /> {tc('patient')}</TabsTrigger>
              <TabsTrigger value="staff" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> {tm('staff')}</TabsTrigger>
            </TabsList>

            <TabsContent value="patient">
              <Card className="border-border/40 bg-card/60 shadow-lg shadow-black/20 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-xl">{t('welcomeBack')}</CardTitle>
                  <CardDescription>{tm('patientPrompt')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {canPasskey && (
                    <>
                      <Button type="button" onClick={() => void faceLogin()} disabled={busy} className="h-14 gap-2 text-base">
                        <ScanFace className="h-5 w-5" /> {tm('faceLogin')}
                      </Button>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />{tm('or')}<span className="h-px flex-1 bg-border" />
                      </div>
                    </>
                  )}
                  <form onSubmit={patientLogin} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pt-user">{tm('username')}</Label>
                      <Input id="pt-user" dir="ltr" autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder="nh1234" value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} className="h-12 text-lg" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pt-pin">{tm('pin')}</Label>
                      <Input id="pt-pin" dir="ltr" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="current-password" placeholder="••••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} className="h-12 text-center text-2xl tracking-[0.5em]" />
                    </div>
                    <Button type="submit" variant={canPasskey ? 'outline' : 'default'} disabled={busy} className="h-12 gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      {t('signinBtn')}
                    </Button>
                  </form>
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">{tm('patientHelp')}</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="staff">
              <Card className="border-border/40 bg-card/60 shadow-lg shadow-black/20 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-xl">{newDoctor ? t('createAccount') : t('welcomeBack')}</CardTitle>
                  <CardDescription>{newDoctor ? tm('newDoctorPrompt') : t('signinPrompt')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={staffLogin} className="flex flex-col gap-4">
                    {newDoctor && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reg-name">{t('fullName')}</Label>
                        <Input id="reg-name" autoComplete="name" value={regName} onChange={(e) => setRegName(e.target.value)} disabled={busy} required />
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="login-email">{t('email')}</Label>
                      <Input id="login-email" type="email" dir="ltr" autoComplete="email" placeholder={t('emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="login-pw">{t('password')}</Label>
                      <div className="relative">
                        <Input id="login-pw" dir="ltr" type={showPw ? 'text' : 'password'} autoComplete={newDoctor ? 'new-password' : 'current-password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required className="pe-10" />
                        <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute top-1/2 end-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showPw ? t('hidePassword') : t('showPassword')}>
                          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    {newDoctor && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reg-invite">{t('inviteCode')}</Label>
                        <Input id="reg-invite" value={regInvite} onChange={(e) => setRegInvite(e.target.value)} disabled={busy} required autoComplete="off" />
                        <p className="text-xs text-muted-foreground">{t('inviteCodeHint')}</p>
                      </div>
                    )}
                    <Button type="submit" disabled={busy} className="mt-1 h-11 gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : newDoctor ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                      {newDoctor ? t('createAccountBtn') : t('signinBtn')}
                    </Button>
                    <button type="button" className="text-xs text-primary underline-offset-4 hover:underline" onClick={() => setNewDoctor((v) => !v)}>
                      {newDoctor ? tm('haveAccount') : tm('newDoctor')}
                    </button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
