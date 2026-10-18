'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Loader2, LogIn, UserPlus, Eye, EyeOff, Shield, UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { ApiError } from '@/lib/api'
import { AuthHero } from '@/components/nuhoud/auth-hero'
import { NeuronMark } from '@/components/nuhoud/neuron-mark'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/


export function AuthScreen() {
  const { login, register } = useAuth()
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const [tab, setTab] = React.useState<'login' | 'register'>('login')
  const [loginEmail, setLoginEmail] = React.useState('')
  const [loginPassword, setLoginPassword] = React.useState('')
  const [showLoginPw, setShowLoginPw] = React.useState(false)
  const [loginBusy, setLoginBusy] = React.useState(false)
  const [regName, setRegName] = React.useState('')
  const [regEmail, setRegEmail] = React.useState('')
  const [regPassword, setRegPassword] = React.useState('')
  const [showRegPw, setShowRegPw] = React.useState(false)
  const [regRole, setRegRole] = React.useState<'PATIENT' | 'DOCTOR'>('PATIENT')
  const [regSide, setRegSide] = React.useState<'right' | 'left' | 'bilateral'>('right')
  const [regInvite, setRegInvite] = React.useState('')
  const [regBusy, setRegBusy] = React.useState(false)

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const email = loginEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) { toast.error(t('invalidCredentials')); return }
    if (!loginPassword) { toast.error(t('passwordRequired')); return }
    setLoginBusy(true)
    try {
      const user = await login(email, loginPassword)
      toast.success(t('welcomeToast', { name: user.name.split(' ')[0] }))
    } catch (err) {
      toast.error(t('invalidCredentials'))
    } finally { setLoginBusy(false) }
  }

  const handleRegister = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const email = regEmail.trim().toLowerCase()
    const name = regName.trim()
    if (!name) return
    if (!EMAIL_RE.test(email)) return
    if (regPassword.length < 6) { toast.error(t('passwordTooShort')); return }
    setRegBusy(true)
    try {
      const user = await register({
        email,
        name,
        password: regPassword,
        role: regRole,
        ...(regRole === 'PATIENT' ? { affectedSide: regSide } : { inviteCode: regInvite.trim() }),
      })
      toast.success(t('welcomeToast', { name: user.name.split(' ')[0] }))
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      toast.error(status === 409 ? t('emailTaken') : status === 403 ? t('inviteRequired') : t('registerFailed'))
    } finally { setRegBusy(false) }
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
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'register')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" className="gap-1.5"><LogIn className="h-3.5 w-3.5" /> {t('signin')}</TabsTrigger>
              <TabsTrigger value="register" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> {t('register')}</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <Card className="border-border/40 bg-card/60 shadow-lg shadow-black/20 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-xl">{t('welcomeBack')}</CardTitle>
                  <CardDescription>{t('signinPrompt')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLogin} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="login-email">{t('email')}</Label>
                      <Input id="login-email" type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} disabled={loginBusy} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="login-pw">{t('password')}</Label>
                      <div className="relative">
                        <Input id="login-pw" type={showLoginPw ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} disabled={loginBusy} required className="pe-10" />
                        <button type="button" onClick={() => setShowLoginPw((s) => !s)} className="absolute top-1/2 end-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showLoginPw ? t('hidePassword') : t('showPassword')}>
                          {showLoginPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" disabled={loginBusy} className="mt-1 h-11 gap-2">
                      {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      {t('signinBtn')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="register">
              <Card className="border-border/40 bg-card/60 shadow-lg shadow-black/20 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-xl">{t('createAccount')}</CardTitle>
                  <CardDescription>{t('registerPrompt')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRegister} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-name">{t('fullName')}</Label>
                      <Input id="reg-name" autoComplete="name" placeholder={t('namePlaceholder')} value={regName} onChange={(e) => setRegName(e.target.value)} disabled={regBusy} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-email">{t('email')}</Label>
                      <Input id="reg-email" type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={regEmail} onChange={(e) => setRegEmail(e.target.value)} disabled={regBusy} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-pw">{t('password')}</Label>
                      <div className="relative">
                        <Input id="reg-pw" type={showRegPw ? 'text' : 'password'} autoComplete="new-password" placeholder={t('passwordPlaceholder')} value={regPassword} onChange={(e) => setRegPassword(e.target.value)} disabled={regBusy} required className="pe-10" />
                        <button type="button" onClick={() => setShowRegPw((s) => !s)} className="absolute top-1/2 end-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showRegPw ? t('hidePassword') : t('showPassword')}>
                          {showRegPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t('accountType')}</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['PATIENT', 'DOCTOR'] as const).map((r) => (
                          <button key={r} type="button" onClick={() => setRegRole(r)} className={cn('flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors', regRole === r ? 'border-primary bg-primary/10 text-primary dark:text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted')}>
                            {r === 'DOCTOR' ? <Shield className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                            {r === 'DOCTOR' ? tc('doctor') : tc('patient')}
                          </button>
                        ))}
                      </div>
                    </div>
                    {regRole === 'PATIENT' ? (
                      <div className="flex flex-col gap-1.5">
                        <Label>{t('affectedSideLabel')}</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {([['right', t('sideRight')], ['left', t('sideLeft')], ['bilateral', t('sideBoth')]] as const).map(([side, label]) => (
                            <button key={side} type="button" onClick={() => setRegSide(side)} className={cn('flex h-10 items-center justify-center rounded-md border text-sm font-medium transition-colors', regSide === side ? 'border-primary bg-primary/10 text-primary dark:text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted')}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reg-invite">{t('inviteCode')}</Label>
                        <Input id="reg-invite" value={regInvite} onChange={(e) => setRegInvite(e.target.value)} disabled={regBusy} required autoComplete="off" />
                        <p className="text-xs text-muted-foreground">{t('inviteCodeHint')}</p>
                      </div>
                    )}
                    <Button type="submit" disabled={regBusy} className="mt-1 h-11 gap-2">
                      {regBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      {t('createAccountBtn')}
                    </Button>
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
