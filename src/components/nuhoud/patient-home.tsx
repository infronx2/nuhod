'use client'

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, CheckCircle2, Hand, Play, Stethoscope, Target, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import type { V2PatientDetail, V2Session } from '@/lib/v2-types'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/** Tasks a session finished: assisted ones count, they were still done. */
function tasksDone(s: V2Session): number {
  return s.correctReps + (s.tasksAssisted ?? 0)
}

function localDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * PatientHome — the patient's whole dashboard: one big button that opens the majlis game on this
 * computer, today's goal from the doctor's plan, the target angle, and recent progress.
 */
export function PatientHome() {
  const { user } = useAuth()
  const t = useTranslations('home')
  const locale = useLocale()
  const [detail, setDetail] = React.useState<V2PatientDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [launchOpen, setLaunchOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!user) return
    try {
      setDetail(await apiFetch<V2PatientDetail>(`/api/v2/patients/${user.id}`))
    } catch {
      /* the page still offers Start session; cards show their empty state */
    } finally {
      setLoading(false)
    }
  }, [user])

  React.useEffect(() => {
    void load()
    // Sessions arrive from the game while this page is open; refresh when the patient comes back to it.
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const plan = detail?.activePlan ?? null
  const sessions = detail?.sessions ?? []
  const goal = plan?.dailyRepGoal ?? 10
  const today = localDay(new Date())
  const doneToday = sessions.filter((s) => localDay(s.sessionDate) === today).reduce((n, s) => n + tasksDone(s), 0)
  const lastBest = sessions[0]?.maxAchievedAngle ?? null
  const limb = plan?.targetLimb ?? (user?.affectedSide === 'left' ? 'upper_left' : user?.affectedSide === 'bilateral' ? 'bilateral' : 'upper_right')
  const handLabel = limb === 'upper_left' ? t('handLeft') : t('handRight')

  const week = React.useMemo(() => {
    const days: { day: string; reps: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = localDay(d)
      days.push({ day: key, reps: sessions.filter((s) => localDay(s.sessionDate) === key).reduce((n, s) => n + tasksDone(s), 0) })
    }
    return days
  }, [sessions])

  const startSession = () => {
    setLaunchOpen(true)
    // The Nuhoud launcher registers nuhoud:// to start the camera server and the game together.
    const link = document.createElement('a')
    link.href = 'nuhoud://start'
    link.click()
  }

  const dateLabel = new Date().toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('greeting', { name: user?.name.split(' ')[0] ?? '' })}</h1>
          <p className="text-sm text-muted-foreground">{dateLabel}</p>
        </div>
      </div>

        {/* Today's session: the one thing this page is for, on the brand's teal surface. */}
        <div className="relative overflow-hidden rounded-[1.5rem] bg-[#0B3E46] p-6 text-white shadow-[0_30px_60px_-30px_rgb(11_62_70/0.8)] sm:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_85%_-20%,rgb(59_179_189/0.35),transparent_70%)]" aria-hidden="true" />
          <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[#7FD8DE]">{t('startTitle')}</span>
              <p className="max-w-md text-xl font-semibold leading-snug">
                {limb === 'bilateral'
                  ? t('startSubtitleBoth', { reps: goal })
                  : t('startSubtitleOne', { reps: goal, hand: handLabel })}
              </p>
            </div>
            <Button
              size="lg"
              onClick={startSession}
              className="h-16 w-full gap-3 rounded-2xl bg-white px-10 text-xl font-semibold text-[#0B3E46] shadow-[0_18px_40px_-14px_rgb(0_0_0/0.5)] hover:bg-[#E2F3F1] sm:w-auto"
            >
              <Play className="h-6 w-6 fill-current" />
              {t('startButton')}
            </Button>
          </div>
        </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card data-tilt className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {t('todayGoal')}
          </div>
          {loading ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <div className="flex items-center gap-6">
              <GoalRing done={doneToday} goal={goal} />
              <div className="flex flex-col gap-1">
                <span className="text-2xl font-bold">{t('tasksDone', { done: Math.min(doneToday, goal), goal })}</span>
                <span className={cn('text-sm', doneToday >= goal ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                  {doneToday >= goal ? t('goalReached') : t('keepGoing', { left: goal - doneToday })}
                </span>
              </div>
            </div>
          )}
        </Card>

        <Card data-tilt className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-primary" />
            {t('targetAngle')}
          </div>
          {loading ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <div className="flex flex-col items-center">
              <TargetArc target={plan?.targetAngle ?? 45} best={lastBest} />
              <p className="text-xs text-muted-foreground">
                {lastBest !== null ? t('lastBest', { angle: Math.round(lastBest) }) : t('targetAngleDesc')}
              </p>
            </div>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-4 border-border/40 bg-card/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Stethoscope className="h-4 w-4 text-primary" />
            {t('planTitle')}
          </div>
          {plan?.doctor?.name && <span className="text-xs text-muted-foreground">{t('prescribedBy', { name: plan.doctor.name })}</span>}
        </div>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !plan ? (
          <p className="text-sm text-muted-foreground">{t('noPlan')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PlanFact icon={Target} label={t('targetAngle')} value={`${plan.targetAngle}°`} />
              <PlanFact icon={CheckCircle2} label={t('dailyTasks')} value={String(plan.dailyRepGoal)} />
              <PlanFact icon={CalendarDays} label={t('sessionsWeek')} value={String(plan.sessionsPerWeek)} />
              <PlanFact icon={Hand} label={t('hand')} value={limb === 'bilateral' ? t('handBothValue') : handLabel} text />
            </div>
            {plan.notes && <p className="rounded-lg bg-muted/40 p-3 text-sm leading-relaxed">{plan.notes}</p>}
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="border-border/40 bg-card/70 p-5 lg:col-span-3">
          <h3 className="mb-2 text-sm font-semibold">{t('weekTitle')}</h3>
          {loading ? <Skeleton className="h-48 w-full" /> : <WeekBars data={week} goal={goal} locale={locale} label={t('dailyTasks')} />}
        </Card>
        <Card className="flex flex-col gap-3 border-border/40 bg-card/70 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold">{t('recentTitle')}</h3>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noSessionsYet')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.slice(0, 4).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {new Date(s.sessionDate).toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('sessionTasks', { done: tasksDone(s), total: s.totalReps })}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-mono text-sm font-semibold" dir="ltr">{Math.round(s.maxAchievedAngle)}°</span>
                    {s.painStop ? (
                      <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]">
                        <TriangleAlert className="h-3 w-3" />
                        {t('painStopped')}
                      </Badge>
                    ) : (s.gripClosureMax ?? 0) > 0 ? (
                      <span className="text-[11px] text-muted-foreground">
                        {t('grip')} <span className="font-mono" dir="ltr">{Math.round(s.gripClosureMax ?? 0)}%</span>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={launchOpen} onOpenChange={setLaunchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('launchingTitle')}</DialogTitle>
            <DialogDescription>{t('launchingDesc')}</DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-3 py-2">
            {[t('step1'), t('step2'), t('step3')].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">{t('launchingNote')}</p>
          <DialogFooter>
            <Button onClick={() => setLaunchOpen(false)}>{t('gotIt')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GoalRing({ done, goal }: { done: number; goal: number }) {
  const pct = Math.min(1, goal > 0 ? done / goal : 0)
  const r = 44
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 110 110" className="h-28 w-28 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="55" cy="55" r={r} fill="none" strokeWidth="12" className="stroke-muted/40" />
      {pct > 0 && <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        strokeWidth="12"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
      />}
      <text
        x="55"
        y="55"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 fill-foreground font-mono text-[22px] font-bold"
        style={{ transformOrigin: '55px 55px' }}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

function PlanFact({ icon: Icon, label, value, text }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; text?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/40 bg-muted/20 p-3">
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {text ? <span className="text-xl font-bold">{value}</span> : <span className="font-mono text-xl font-bold" dir="ltr">{value}</span>}
    </div>
  )
}

/** Shoulder elevation as a half dial: 0° at the left end (arm down), 180° at the right (arm overhead). */
function TargetArc({ target, best }: { target: number; best: number | null }) {
  const R = 80
  const CX = 100
  const CY = 100
  const point = (deg: number, radius = R) => {
    const a = Math.PI * (1 - Math.min(180, Math.max(0, deg)) / 180)
    return { x: Math.round((CX + radius * Math.cos(a)) * 100) / 100, y: Math.round((CY - radius * Math.sin(a)) * 100) / 100 }
  }
  const arc = (from: number, to: number) => {
    const p0 = point(from)
    const p1 = point(to)
    return `M ${p0.x} ${p0.y} A ${R} ${R} 0 0 1 ${p1.x} ${p1.y}`
  }
  const tickIn = point(target, R - 14)
  const tickOut = point(target, R + 14)
  return (
    <svg viewBox="0 0 200 112" className="w-full max-w-[260px]" role="img" aria-label={`${target}°`}>
      <path d={arc(0, 180)} fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-muted" />
      {best !== null && best > 0 && (
        <path d={arc(0, best)} fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-primary" />
      )}
      <line x1={tickIn.x} y1={tickIn.y} x2={tickOut.x} y2={tickOut.y} strokeWidth="4" strokeLinecap="round" className="stroke-amber-500" />
      <text x={CX} y={CY - 14} textAnchor="middle" className="fill-foreground font-mono text-[34px] font-bold">{target}°</text>
    </svg>
  )
}

function WeekBars({ data, goal, locale, label }: { data: { day: string; reps: number }[]; goal: number; locale: string; label: string }) {
  const rows = data.map((d) => ({
    label: new Date(`${d.day}T12:00:00`).toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB', { weekday: 'short' }),
    reps: d.reps,
  }))
  return (
    <div className="h-48 w-full text-primary" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'currentColor' }} />
          <YAxis allowDecimals={false} domain={[0, Math.max(goal, ...rows.map((r) => r.reps))]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'currentColor' }} />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.08)' }}
            contentStyle={{ background: 'rgba(15,23,42,0.96)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8, fontSize: 11, color: '#e2e8f0' }}
            formatter={(value: number) => [value, label]}
          />
          <ReferenceLine y={goal} stroke="var(--chart-4)" strokeDasharray="4 4" />
          <Bar dataKey="reps" fill="currentColor" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
