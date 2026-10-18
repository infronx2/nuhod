'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Send, Sparkles, X, Trash2, Loader2, User, Bot, Check, ArrowLeftRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

interface PlanProposal {
  patientId: string
  title: string
  targetLimb: string
  targetAngle: number
  sessionsPerWeek: number
  dailyRepGoal: number
  notes: string | null
  reason: string
  current: { targetAngle: number; sessionsPerWeek: number; dailyRepGoal: number } | null
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
  source?: 'deepseek' | 'fallback' | 'safety'
  proposal?: PlanProposal | null
  proposalState?: 'open' | 'applying' | 'applied' | 'dismissed'
}

interface AgentChatProps {
  /** For doctors: the patient to ask about (without it, Mu'in covers the whole roster). Patients omit it. */
  patientId?: string
  patientName?: string
  /**
   * compact = floating button + slide-in fixed panel (default).
   * full = larger fixed panel.
   * embedded = inline panel rendered in the page flow (no floating button,
   *           always open, no fixed positioning). Use this when the parent
   *           already provides its own toggle (e.g. the doctor's
   *           patient-detail "Ask Mu'in" button).
   */
  variant?: 'compact' | 'full' | 'embedded'
  /** Called after the doctor approves a plan Mu'in proposed. */
  onPlanApplied?: () => void
}

const SUGGESTED_KEYS = {
  patient: ['suggested1', 'suggested2', 'suggested3', 'suggested4'],
  doctor_patient: ['doctorSuggested1', 'doctorSuggested2', 'doctorSuggested3', 'doctorSuggested4'],
  doctor_roster: ['rosterSuggested1', 'rosterSuggested2', 'rosterSuggested3'],
} as const

/**
 * AgentChat — the chat panel of Mu'in (مُعين), Nuhoud's assistant.
 *
 * Calls POST /api/v2/agent/chat. For a patient it talks about their own rehab; for a doctor it
 * talks about one patient (patientId) or the whole roster (no patientId), and shows plan changes
 * it proposes as cards the doctor approves with the regular plan endpoint.
 */
export function AgentChat({ patientId, patientName, variant = 'full', onPlanApplied }: AgentChatProps) {
  const { user } = useAuth()
  const t = useTranslations('coach')
  const isDoctor = user?.role === 'DOCTOR'
  const mode = !isDoctor ? 'patient' : patientId ? 'doctor_patient' : 'doctor_roster'
  const subtitle = patientName
    ? t('coaching', { name: patientName })
    : mode === 'doctor_roster'
      ? t('rosterAssistant')
      : t('subtitle')
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // For the embedded variant, the panel is always "open" and there's no
  // floating button — the parent controls visibility by mounting/unmounting.
  const embedded = variant === 'embedded'

  // Load the persisted conversation (including Mu'in's after-session notes) when the panel opens.
  React.useEffect(() => {
    if (!user) return
    if (!embedded && !open) return
    let cancelled = false
    const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''
    apiFetch<{ ok: boolean; messages: Array<{ role: string; content: string; createdAt: string }> }>(
      `/api/v2/chat-history${qs}`,
    )
      .then((data) => {
        if (cancelled || !data.ok) return
        setMessages(
          data.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            ts: new Date(m.createdAt).getTime(),
          })),
        )
      })
      .catch(() => {
        /* silent — history load is best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [user, open, embedded, patientId])

  // Auto-scroll to the latest message.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return
      setInput('')
      setMessages((prev) => [...prev, { role: 'user', content: trimmed, ts: Date.now() }])
      setLoading(true)
      try {
        const res = await apiFetch<{
          ok: boolean
          reply: string
          source?: ChatMessage['source']
          proposal?: PlanProposal | null
          error?: string
        }>('/api/v2/agent/chat', {
          method: 'POST',
          body: JSON.stringify({ message: trimmed, patientId }),
        })
        if (!res.ok) throw new Error(res.error || 'chat failed')
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: res.reply,
            ts: Date.now(),
            source: res.source,
            proposal: res.proposal ?? null,
            proposalState: res.proposal ? 'open' : undefined,
          },
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        toast.error(t('coachUnavailable'), { description: msg })
        setMessages((prev) => [...prev, { role: 'assistant', content: t('coachUnavailable'), ts: Date.now() }])
      } finally {
        setLoading(false)
      }
    },
    [loading, patientId, t],
  )

  const setProposalState = React.useCallback(
    (index: number, proposalState: ChatMessage['proposalState']) =>
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, proposalState } : m))),
    [],
  )

  // The doctor's approval goes through the same endpoint as the plan editor.
  const applyProposal = React.useCallback(
    async (index: number, p: PlanProposal) => {
      setProposalState(index, 'applying')
      try {
        await apiFetch(`/api/v2/patients/${p.patientId}/plans`, {
          method: 'POST',
          body: JSON.stringify({
            title: p.title,
            targetLimb: p.targetLimb,
            targetAngle: p.targetAngle,
            sessionsPerWeek: p.sessionsPerWeek,
            dailyRepGoal: p.dailyRepGoal,
            notes: p.notes,
          }),
        })
        setProposalState(index, 'applied')
        toast.success(t('planApplied'))
        onPlanApplied?.()
      } catch (err) {
        setProposalState(index, 'open')
        toast.error(t('planApplyFailed'), { description: err instanceof Error ? err.message : undefined })
      }
    },
    [onPlanApplied, setProposalState, t],
  )

  const clearChat = React.useCallback(async () => {
    setMessages([])
    try {
      await apiFetch(`/api/v2/agent/chat${patientId ? `?patientId=${patientId}` : ''}`, { method: 'DELETE' })
      toast.success(t('conversationCleared'))
    } catch {
      /* silent */
    }
  }, [patientId, t])

  const isRTLText = (text: string) => /[؀-ۿ]/.test(text)

  // The panel content — shared between the floating (compact/full) and the
  // inline (embedded) variants.
  const panel = (
    <>
      {/* Messages */}
      <div ref={scrollRef} className="nm-scroll-thin flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <MessageSquare className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('askCoach')}</p>
              <p className="text-xs text-muted-foreground">
                {t(mode === 'patient' ? 'coachPrompt' : mode === 'doctor_patient' ? 'doctorPrompt' : 'rosterPrompt')}
              </p>
            </div>
            <div className="flex w-full flex-col gap-1.5">
              {SUGGESTED_KEYS[mode].map((key) => (
                <button
                  key={key}
                  onClick={() => send(t(key))}
                  className="rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              m.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {m.role === 'assistant' && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-emerald-600 text-white">
                <Bot className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : m.source === 'safety'
                    ? 'border border-red-500/50 bg-red-500/10 text-foreground'
                    : 'bg-card border border-border/40 text-foreground',
              )}
              dir={isRTLText(m.content) ? 'rtl' : 'ltr'}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {m.source === 'fallback' && (
                <p className="mt-1 text-[10px] text-muted-foreground">{t('offline')}</p>
              )}
              {m.proposal && m.proposalState !== 'dismissed' && (
                <ProposalCard
                  proposal={m.proposal}
                  state={m.proposalState ?? 'open'}
                  onApprove={() => void applyProposal(i, m.proposal!)}
                  onDismiss={() => setProposalState(i, 'dismissed')}
                  t={t}
                />
              )}
            </div>
            {m.role === 'user' && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-emerald-600 text-white">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl bg-card border border-border/40 px-3 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/40 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            placeholder={t('typeQuestion')}
            rows={1}
            className="nm-scroll-thin max-h-24 flex-1 resize-none rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            disabled={loading}
          />
          <Button
            size="icon"
            onClick={() => void send(input)}
            disabled={!input.trim() || loading}
            className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-primary to-emerald-600 text-white hover:from-primary hover:to-emerald-700"
            aria-label={t('sendMessage')}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
          {t('contextAware')}
        </p>
      </div>
    </>
  )

  const header = (closeButton: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-gradient-to-r from-primary/10 to-emerald-500/10 p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-emerald-600 text-white">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={clearChat}
          aria-label={t('clearConversation')}
          disabled={messages.length === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {closeButton}
      </div>
    </div>
  )

  // ---- Embedded variant: inline in the page flow, no floating button ----
  if (embedded) {
    return (
      <div className="flex h-[28rem] flex-col rounded-2xl border border-border/60 bg-card/95 shadow-lg shadow-black/20 backdrop-blur-xl">
        {header(null)}
        {panel}
      </div>
    )
  }

  // ---- Floating variants (compact / full) ----
  return (
    <>
      {/* Trigger button (floating, bottom-right) */}
      {!open && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-emerald-600 text-white shadow-lg shadow-primary/30 ring-2 ring-primary/40"
          aria-label={t('openCoach')}
        >
          <Sparkles className="h-6 w-6" aria-hidden="true" />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
          </span>
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'fixed z-50 flex flex-col rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-black/40 backdrop-blur-xl',
              variant === 'compact'
                ? 'bottom-6 right-6 h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)]'
                : 'inset-x-4 bottom-4 top-4 sm:inset-x-auto sm:right-6 sm:top-20 sm:bottom-6 sm:h-[36rem] sm:w-[24rem]',
            )}
          >
            {header(
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label={t('closeCoach')}
              >
                <X className="h-4 w-4" />
              </Button>,
            )}
            {panel}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** A plan change Mu'in proposed: current → proposed values, the reason, and approve / dismiss. */
function ProposalCard({
  proposal: p,
  state,
  onApprove,
  onDismiss,
  t,
}: {
  proposal: PlanProposal
  state: NonNullable<ChatMessage['proposalState']>
  onApprove: () => void
  onDismiss: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const rows: Array<[string, number | undefined, number, string]> = [
    [t('proposalAngle'), p.current?.targetAngle, p.targetAngle, '°'],
    [t('proposalDaily'), p.current?.dailyRepGoal, p.dailyRepGoal, ''],
    [t('proposalWeekly'), p.current?.sessionsPerWeek, p.sessionsPerWeek, ''],
  ]
  return (
    <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-2.5">
      <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-primary">
        <ArrowLeftRight className="h-3 w-3" />
        {t('proposalTitle')}
      </p>
      <dl className="space-y-0.5 text-xs">
        {rows.map(([label, from, to, unit]) => {
          const changed = from !== undefined && from !== to
          return (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={cn('tabular-nums', changed && 'font-semibold text-primary')} dir="ltr">
                {changed ? `${from}${unit} → ${to}${unit}` : `${to}${unit}`}
              </dd>
            </div>
          )
        })}
      </dl>
      {p.reason && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{p.reason}</p>}
      <div className="mt-2 flex gap-1.5">
        {state === 'applied' ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check className="h-3.5 w-3.5" />
            {t('proposalApplied')}
          </span>
        ) : (
          <>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={onApprove} disabled={state === 'applying'}>
              {state === 'applying' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {t('approvePlan')}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDismiss} disabled={state === 'applying'}>
              {t('dismiss')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
