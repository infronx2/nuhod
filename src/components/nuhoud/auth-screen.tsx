'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Loader2, LogIn, UserPlus, Eye, EyeOff, Shield, UserRound, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DEMO_ACCOUNTS = [
  { email: 'doctor@nuhoud.health', password: 'demo1234', role: 'DOCTOR' as const, icon: Shield, accent: 'text-amber-500', labelKey: 'demoDoctor' },
  { email: 'layla@nuhoud.health', password: 'demo1234', role: 'PATIENT' as const, icon: UserRound, accent: 'text-primary', labelKey: 'demoPatient1' },
  { email: 'omar@nuhoud.health', password: 'demo1234', role: 'PATIENT' as const, icon: UserRound, accent: 'text-emerald-500', labelKey: 'demoPatient2' },
]

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
      const user = await register({ email, name, password: regPassword, role: regRole })
      toast.success(t('welcomeToast', { name: user.name.split(' ')[0] }))
    } catch (err) {
      toast.error(t('invalidCredentials'))
    } finally { setRegBusy(false) }
  }

  const quickLogin = async (email: string, password: string) => {
    setLoginEmail(email); setLoginPassword(password); setTab('login'); setLoginBusy(true)
    try {
      const user = await login(email, password)
      toast.success(t('welcomeToast', { name: user.name.split(' ')[0] }))
    } catch { toast.error(t('invalidCredentials')) }
    finally { setLoginBusy(false) }
  }

  return (
    <div className="nm-mesh-bg grid min-h-screen w-full grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-24 top-24 h-96 w-96 rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle at center, rgba(11, 83, 148,0.45), transparent 70%)' }} aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full opacity-30 blur-3xl" style={{ background: 'radial-gradient(circle at center, rgba(245,158,11,0.35), transparent 70%)' }} aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-3">
          <motion.div initial={{ rotate: -8, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.5 }} className="text-primary">
            <NeuronMark className="h-12 w-12" />
          </motion.div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold tracking-tight text-white">{tc('appName')}</span>
            <span className="text-xs text-slate-400">{t('heroHighlight')}</span>
          </div>
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }} className="relative z-10 flex flex-col gap-4">
          <h1 className="max-w-md text-4xl font-bold leading-tight text-white">
            {t('heroHeadline')}{' '}
            <span className="bg-gradient-to-r from-primary to-emerald-300 bg-clip-text text-transparent">{t('heroHighlight')}</span>.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-slate-300">{t('heroDescription')}</p>
          <ul className="flex flex-col gap-2 text-sm text-slate-300">
            <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t('feature1')}</li>
            <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t('feature2')}</li>
            <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t('feature3')}</li>
          </ul>
        </motion.div>
        <div className="relative z-10 text-xs text-slate-500">{t('phaseLabel')}</div>
      </div>

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
                    <Button type="submit" disabled={loginBusy} className="mt-1 h-10 gap-2 bg-primary text-white hover:bg-primary">
                      {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      {t('signinBtn')}
                    </Button>
                  </form>
                  <DemoQuickLogin onPick={quickLogin} busy={loginBusy} t={t} />
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
                    <Button type="submit" disabled={regBusy} className="mt-1 h-10 gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
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

function DemoQuickLogin({ onPick, busy, t }: { onPick: (email: string, password: string) => void; busy: boolean; t: any }) {
  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border/60" />
        <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{t('demoAccounts')}</span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      <div className="flex flex-col gap-1.5">
        {DEMO_ACCOUNTS.map((acc) => {
          const Icon = acc.icon
          return (
            <button key={acc.email} type="button" disabled={busy} onClick={() => onPick(acc.email, acc.password)} className="group flex h-9 items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50">
              <Icon className={cn('h-3.5 w-3.5', acc.accent)} />
              <span className="font-medium text-foreground">{t(acc.labelKey)}</span>
              <span className="ms-auto text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{t('clickHint')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NeuronMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Nuhoud logo" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
        <path d="M32 4 L32 12" /><path d="M52 16 L46 21" /><path d="M60 32 L52 32" /><path d="M52 48 L46 43" /><path d="M32 60 L32 52" /><path d="M12 48 L18 43" /><path d="M4 32 L12 32" /><path d="M12 16 L18 21" />
      </g>
      <circle cx="32" cy="32" r="6" fill="currentColor" />
      <path d="M20 40 Q32 50 44 36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <circle cx="20" cy="40" r="3" fill="currentColor" />
      <circle cx="44" cy="36" r="3" fill="currentColor" />
    </svg>
  )
}
