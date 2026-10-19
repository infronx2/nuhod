'use client'

import * as React from 'react'
import { Camera, Hand, Loader2, OctagonAlert, RotateCcw, Smartphone, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NeuronMark } from '@/components/nuhoud/neuron-mark'
import { useAuth } from '@/hooks/use-auth'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Game, HudState } from './game'
import type { Plan } from './tasks'
import { flushPending, saveSession } from './session'

type Phase = 'intro' | 'check' | 'rest' | 'loading' | 'position' | 'play' | 'after' | 'saving' | 'done' | 'error'

interface ActivePlan { targetAngle: number; dailyRepGoal: number; targetLimb: string; active: boolean; maxSessionMinutes?: number }

const POSITION_HOLD_MS = 1500

/**
 * PlayGame — the majlis session in the browser. Steps: how to set up the phone, camera permission
 * (it must come from a tap on iPhone), a check that the camera sees the shoulders and hands, then
 * the session, then saving it for the doctor.
 */
export function PlayGame() {
  const { user, loading: authLoading } = useAuth()
  const [phase, setPhase] = React.useState<Phase>('intro')
  const [error, setError] = React.useState('')
  const [errorDetail, setErrorDetail] = React.useState('')
  const [hud, setHud] = React.useState<HudState | null>(null)
  const [muted, setMuted] = React.useState(false)
  const [saved, setSaved] = React.useState<boolean | null>(null)
  const [summary, setSummary] = React.useState<{ tasks: number; angle: number; minutes: number; painStop: boolean } | null>(null)
  const [plan, setPlan] = React.useState<Plan>({ targetAngle: 45, dailyTasks: 0, limb: 'both' })
  // Before the session: pain 0-10 and tiredness 0-2; after it: pain again. Sent with the session.
  const [painBefore, setPainBefore] = React.useState<number | null>(null)
  const [fatigue, setFatigue] = React.useState<number | null>(null)
  const [maxMinutes, setMaxMinutes] = React.useState(20)
  const [timeUp, setTimeUp] = React.useState(false)
  const stage = React.useRef<HTMLDivElement>(null)
  const video = React.useRef<HTMLVideoElement>(null)
  const game = React.useRef<Game | null>(null)
  const positionedSince = React.useRef<number | null>(null)
  const lastHud = React.useRef(0)

  // The doctor's active plan, and any session from an earlier visit still waiting to be sent.
  React.useEffect(() => {
    if (!user) return
    void flushPending(user.id)
    apiFetch<{ ok: boolean; plans: ActivePlan[] }>(`/api/v2/patients/${user.id}/plans`)
      .then((d) => {
        const p = d.plans?.find((x) => x.active)
        if (p?.maxSessionMinutes) setMaxMinutes(p.maxSessionMinutes)
        if (p) setPlan({
          targetAngle: p.targetAngle,
          dailyTasks: p.dailyRepGoal,
          limb: p.targetLimb === 'upper_right' ? 'right' : p.targetLimb === 'upper_left' ? 'left' : 'both',
        })
      })
      .catch(() => undefined)
  }, [user])

  const extras = React.useCallback((painAfter: number | null) => ({ painBefore, fatigueBefore: fatigue, painAfter }), [painBefore, fatigue])

  /** Ends the session; one worth keeping first asks how the pain is now, then saves. */
  const finish = React.useCallback(() => {
    const g = game.current
    if (!g || !user) return
    g.end()
    const r = g.record
    setSummary({ tasks: r.reps, angle: Math.round(r.maxAngle), minutes: Math.max(1, Math.round(r.seconds / 60)), painStop: r.painStop })
    if (r.worthSaving()) {
      setPhase('after')
    } else {
      setSaved(null)
      setPhase('done')
    }
  }, [user])

  const save = React.useCallback(async (painAfter: number | null) => {
    const g = game.current
    if (!g || !user) return
    setPhase('saving')
    g.voice.say('session_end')
    setSaved(await saveSession({ ...g.record.payload(user.id), ...extras(painAfter) }))
    setPhase('done')
  }, [user, extras])

  // The doctor's limit on session length: the session ends and the patient is asked to rest.
  React.useEffect(() => {
    if (phase !== 'play') return
    const id = setTimeout(() => { setTimeUp(true); finish() }, maxMinutes * 60_000)
    return () => clearTimeout(id)
  }, [phase, maxMinutes, finish])

  const submitCheck = async () => {
    if (painBefore === null || fatigue === null) return
    let allowed = painBefore < 7 && fatigue < 2
    try {
      allowed = (await apiFetch<{ allowed: boolean }>('/api/v2/checkins', { method: 'POST', json: { pain: painBefore, fatigue } })).allowed
    } catch { /* offline: decide here with the same rule */ }
    if (allowed) void begin()
    else setPhase('rest')
  }

  // Leaving mid-session keeps the session in the browser; it is sent on the next visit.
  React.useEffect(() => {
    const onHide = () => {
      const g = game.current
      if (g && user && phase === 'play' && g.record.worthSaving()) {
        try {
          const key = 'nuhoud_pending_sessions'
          const list = JSON.parse(localStorage.getItem(key) || '[]').filter((x: { clientSessionId: string }) => x.clientSessionId !== g.record.clientSessionId)
          localStorage.setItem(key, JSON.stringify([...list, { ...g.record.payload(user.id), ...extras(null) }]))
        } catch { /* storage blocked */ }
      }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [phase, user, extras])

  React.useEffect(() => () => {
    game.current?.dispose()
    const stream = video.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
  }, [])

  const begin = async () => {
    setPhase('loading')
    // Which step failed, so the message (and what the patient reports back) says where it stopped.
    let step: 'camera' | 'video' | 'scene' | 'tracking' = 'camera'
    try {
      // In-app browsers (WhatsApp, Instagram…) and plain http have no camera API at all.
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no mediaDevices'), { name: 'NoCameraApi' })
      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === 'NotAllowedError') throw e
          // Some cameras refuse the size hints; any front camera will do.
          return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        })
      step = 'video'
      const v = video.current!
      v.srcObject = stream
      await v.play()
      step = 'scene'
      const { Game } = await import('./game')
      const g = new Game(stage.current!, v, plan, (s) => {
        // The HUD needs about ten updates a second, not sixty.
        const t = performance.now()
        if (t - lastHud.current < 100) return
        lastHud.current = t
        setHud(s)
        if (!s.instruction && (s.body && (s.hands.right || s.hands.left))) {
          positionedSince.current ??= t
        } else if (!s.instruction) {
          positionedSince.current = null
        }
      }, () => finish())
      g.voice.unlock()
      game.current = g
      step = 'tracking'
      await g.load()
      g.startPreview()
      setPhase('position')
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      const message = err instanceof Error ? err.message : String(err)
      console.error('[play] start failed at', step, err)
      setError(
        name === 'NotAllowedError'
          ? 'لازم تسمح باستخدام الكاميرا عشان نتابع حركة يدك. من إعدادات Safari ← الكاميرا ← اسمح.'
          : name === 'NoCameraApi'
            ? 'المتصفح هذا ما يسمح بالكاميرا. افتح الرابط في Safari أو Chrome مباشرة (مو من داخل واتساب أو انستقرام).'
            : name === 'NotReadableError'
              ? 'الكاميرا مشغولة في تطبيق ثاني. سكّره وحاول مرة ثانية.'
              : step === 'tracking'
                ? 'تعذّر تحميل نظام التتبع. تأكد من الإنترنت وحاول مرة ثانية.'
                : 'تعذّر تشغيل الكاميرا على هذا الجهاز.',
      )
      setErrorDetail(`${step} · ${name || 'Error'}: ${message}`.slice(0, 160))
      setPhase('error')
    }
  }

  // Start once the camera has seen the body and a hand for a moment.
  React.useEffect(() => {
    if (phase !== 'position') return
    const id = setInterval(() => {
      if (positionedSince.current !== null && performance.now() - positionedSince.current > POSITION_HOLD_MS) {
        clearInterval(id)
        game.current?.start()
        setPhase('play')
      }
    }, 200)
    return () => clearInterval(id)
  }, [phase])

  React.useEffect(() => {
    if (game.current) game.current.voice.muted = muted
  }, [muted])

  if (authLoading) return <FullScreen><Loader2 className="h-8 w-8 animate-spin text-white/70" /></FullScreen>
  if (!user) {
    return (
      <FullScreen>
        <Panel>
          <p className="text-lg font-semibold">سجّل دخولك أولاً</p>
          <Button asChild className="mt-4 h-12 w-full text-base"><a href="/">الذهاب لتسجيل الدخول</a></Button>
        </Panel>
      </FullScreen>
    )
  }

  if (user.role === 'PATIENT' && !user.patientConsentAt) {
    return (
      <FullScreen>
        <Panel>
          <p className="text-lg font-semibold">قبل أول جلسة</p>
          <p className="mt-2 text-sm text-white/80">اقرأ معلومات البرنامج ووافق عليها من الصفحة الرئيسية.</p>
          <Button asChild className="mt-4 h-12 w-full text-base"><a href="/">الصفحة الرئيسية</a></Button>
        </Panel>
      </FullScreen>
    )
  }

  const goalText = plan.dailyTasks > 0 ? `${hud?.done ?? 0} / ${plan.dailyTasks}` : `${hud?.done ?? 0}`
  const seen = hud?.body && (hud.hands.right || hud.hands.left)

  return (
    <div dir="rtl" className="fixed inset-0 overflow-hidden bg-[#1d140d] text-white select-none">
      <div ref={stage} className="absolute inset-0" />
      {/* The camera feed: hidden from the scene, shown small (mirrored, like a selfie) while positioning and playing. */}
      <video
        ref={video}
        playsInline
        muted
        className={cn(
          'absolute bottom-4 left-4 z-20 w-28 -scale-x-100 rounded-xl border border-white/20 object-cover shadow-lg sm:w-36',
          phase === 'position' || phase === 'play' ? 'opacity-90' : 'pointer-events-none opacity-0',
        )}
      />

      {phase === 'intro' && (
        <FullScreen>
          <Panel>
            <div className="flex items-center gap-2.5">
              <NeuronMark className="h-9 w-9 text-[#7FD8DE]" />
              <span className="text-xl font-semibold">جلسة المجلس</span>
            </div>
            <ul className="mt-5 flex flex-col gap-3 text-[15px] leading-relaxed text-white/85">
              <Step icon={Smartphone}>حط الجوال بالعرض على حامل أو مسند قدامك، على بعد ذراع تقريباً.</Step>
              <Step icon={Camera}>اجلس بحيث يبان كتفينك ويدينك في الكاميرا، والإضاءة من قدامك.</Step>
              <Step icon={Hand}>
                {plan.limb === 'both' ? 'بتتمرن بيدينك الثنتين.' : `بتتمرن بيدك ${plan.limb === 'right' ? 'اليمنى' : 'اليسرى'}.`}
                {plan.dailyTasks > 0 && ` هدف اليوم ${plan.dailyTasks} مهمة.`}
              </Step>
              <Step icon={OctagonAlert}>إذا حسيت بألم، اضغط زر «ألم» الأحمر وتوقف الجلسة فوراً.</Step>
            </ul>
            <Button onClick={() => setPhase('check')} className="mt-6 h-14 w-full rounded-2xl bg-white text-lg font-semibold text-[#0B3E46] hover:bg-[#E2F3F1]">
              ابدأ
            </Button>
            <p className="mt-3 text-center text-xs text-white/50">التتبع يصير داخل جهازك، والفيديو ما يطلع منه.</p>
          </Panel>
        </FullScreen>
      )}

      {phase === 'loading' && (
        <FullScreen>
          <Loader2 className="h-9 w-9 animate-spin text-[#7FD8DE]" />
          <p className="mt-4 text-base text-white/80">نجهّز المجلس والكاميرا…</p>
        </FullScreen>
      )}

      {phase === 'position' && (
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center p-4">
          <div className="max-w-md rounded-2xl bg-black/55 px-5 py-4 text-center backdrop-blur-md">
            <p className="text-lg font-semibold">{seen ? 'ممتاز، ثبّت مكانك…' : 'خلنا نشوفك'}</p>
            <p className="mt-1 text-sm text-white/75">
              {!hud?.body ? 'ابعد شوي لين يبان كتفينك في الكاميرا' : !seen ? 'ارفع يدك قدام الكاميرا' : 'الجلسة بتبدأ الحين'}
            </p>
          </div>
        </div>
      )}

      {phase === 'play' && hud && (
        <>
          <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-2xl bg-black/50 px-4 py-2 text-lg font-semibold tabular-nums backdrop-blur-md">{goalText}</span>
              <span className="hidden rounded-2xl bg-black/40 px-3 py-2 text-sm tabular-nums text-white/80 backdrop-blur-md sm:inline">{hud.score} نقطة</span>
            </div>
            <div className="flex items-center gap-2">
              <IconButton label={muted ? 'تشغيل الصوت' : 'كتم الصوت'} onClick={() => setMuted((m) => !m)}>
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </IconButton>
              <IconButton label="إنهاء الجلسة" onClick={() => finish()}><X className="h-5 w-5" /></IconButton>
            </div>
          </div>
          {!seen && (
            <div className="absolute inset-x-0 top-20 z-10 flex justify-center px-4">
              <p className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-medium text-black">ما نشوف يدك… ارجع لمكانك قدام الكاميرا</p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-4 pb-6">
            {hud.instruction && (
              <p className="max-w-xl rounded-2xl bg-black/55 px-5 py-3 text-center text-lg font-semibold leading-snug backdrop-blur-md sm:text-xl">
                {hud.instruction}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => { game.current?.painStop(); finish() }}
            className="absolute bottom-5 right-4 z-20 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-[#D64545] text-sm font-bold shadow-[0_10px_30px_-8px_rgb(214_69_69/0.8)] active:scale-95 sm:h-20 sm:w-20"
            aria-label="أحس بألم، أوقف الجلسة"
          >
            <OctagonAlert className="h-6 w-6" />
            ألم
          </button>
        </>
      )}

      {phase === 'check' && (
        <FullScreen>
          <Panel>
            <p className="text-lg font-semibold">قبل ما نبدأ، كيف حالك الحين؟</p>
            <PainScale label="كم الألم في يدك أو كتفك؟" value={painBefore} onChange={setPainBefore} />
            <p className="mt-5 text-sm text-white/80">وكيف التعب؟</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {['مرتاح', 'تعبان شوي', 'تعبان وايد'].map((label, i) => (
                <button key={label} type="button" onClick={() => setFatigue(i)}
                  className={cn('h-12 rounded-xl border text-sm font-medium', fatigue === i ? 'border-white bg-white text-[#0B3E46]' : 'border-white/20 bg-white/5')}>
                  {label}
                </button>
              ))}
            </div>
            <Button disabled={painBefore === null || fatigue === null} onClick={() => void submitCheck()} className="mt-6 h-14 w-full rounded-2xl bg-white text-lg font-semibold text-[#0B3E46] hover:bg-[#E2F3F1]">
              تابع
            </Button>
          </Panel>
        </FullScreen>
      )}

      {phase === 'rest' && (
        <FullScreen>
          <Panel>
            <p className="text-2xl font-semibold">خلنا نرتاح اليوم</p>
            <p className="mt-3 text-sm leading-relaxed text-white/80">
              {painBefore !== null && painBefore >= 7 ? 'الألم عالي اليوم، والتمرين ممكن يزيده.' : 'جسمك محتاج راحة اليوم.'} وصلت ملاحظتك لطبيبك.
              إذا الألم قوي أو جديد، كلّم طبيبك أو اتصل بالطوارئ.
            </p>
            <Button asChild className="mt-6 h-12 w-full rounded-xl bg-white text-base font-semibold text-[#0B3E46] hover:bg-[#E2F3F1]"><a href="/">الرئيسية</a></Button>
          </Panel>
        </FullScreen>
      )}

      {phase === 'after' && (
        <FullScreen>
          <Panel>
            <p className="text-lg font-semibold">{timeUp ? 'خلص وقت جلسة اليوم، أحسنت' : 'خلصت الجلسة'}</p>
            <PainScale label="وكم الألم الحين؟" value={null} onChange={(v) => void save(v)} />
            <button type="button" onClick={() => void save(null)} className="mt-4 w-full text-center text-sm text-white/60 underline-offset-4 hover:underline">تخطي</button>
          </Panel>
        </FullScreen>
      )}

      {(phase === 'saving' || phase === 'done') && (
        <FullScreen>
          <Panel>
            <p className="text-2xl font-semibold">{summary?.painStop ? 'سلامتك' : 'يعطيك العافية'}</p>
            {summary?.painStop && (
              <p className="mt-2 text-sm leading-relaxed text-white/80">ارتاح الحين. إذا استمر الألم أو كان قوي، كلّم طبيبك.</p>
            )}
            {summary && (
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <Stat value={String(summary.tasks)} label="مهمة" />
                <Stat value={`${summary.angle}°`} label="أقصى زاوية" />
                <Stat value={String(summary.minutes)} label="دقيقة" />
              </div>
            )}
            <p className="mt-5 text-center text-sm text-white/70">
              {phase === 'saving' ? 'نحفظ الجلسة…' : saved === true ? 'وصلت الجلسة لطبيبك.' : saved === false ? 'بنرسلها لطبيبك أول ما يرجع الإنترنت.' : 'الجلسة قصيرة وما انحفظت.'}
            </p>
            <div className="mt-5 flex gap-2">
              <Button asChild className="h-12 flex-1 rounded-xl bg-white text-base font-semibold text-[#0B3E46] hover:bg-[#E2F3F1]"><a href="/">الرئيسية</a></Button>
              <Button variant="outline" className="h-12 flex-1 rounded-xl border-white/25 bg-transparent text-base text-white hover:bg-white/10" onClick={() => window.location.reload()}>
                <RotateCcw className="h-4 w-4" /> جلسة جديدة
              </Button>
            </div>
          </Panel>
        </FullScreen>
      )}

      {phase === 'error' && (
        <FullScreen>
          <Panel>
            <p className="text-lg font-semibold">ما قدرنا نبدأ</p>
            <p className="mt-2 text-sm leading-relaxed text-white/80">{error}</p>
            {errorDetail && <p dir="ltr" className="mt-3 break-all rounded-lg bg-black/25 px-3 py-2 text-left font-mono text-[11px] text-white/50">{errorDetail}</p>}
            <Button className="mt-5 h-12 w-full" onClick={() => window.location.reload()}>حاول مرة ثانية</Button>
          </Panel>
        </FullScreen>
      )}
    </div>
  )
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div dir="rtl" className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B3E46]/92 p-4 text-white backdrop-blur-sm">{children}</div>
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-md rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl">{children}</div>
}

function Step({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-white/10"><Icon className="h-4 w-4 text-[#7FD8DE]" /></span>
      <span>{children}</span>
    </li>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/[0.07] py-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-white/65">{label}</p>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/50 backdrop-blur-md active:scale-95">
      {children}
    </button>
  )
}

/** 0 (no pain) to 10 (worst), as big buttons a patient can tap with one finger. */
function PainScale({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="mt-4">
      <p className="text-sm text-white/80">{label}</p>
      <div className="mt-2 grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} من 10`}
            className={cn('h-11 rounded-lg text-base font-semibold tabular-nums',
              value === n ? 'bg-white text-[#0B3E46]' : n >= 7 ? 'bg-[#D64545]/30' : n >= 4 ? 'bg-amber-500/25' : 'bg-emerald-500/20')}>
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-white/50"><span>ما فيه ألم</span><span>ألم شديد</span></div>
    </div>
  )
}
