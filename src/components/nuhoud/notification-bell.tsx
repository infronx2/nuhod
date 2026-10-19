'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  Check,
  Award,
  Stethoscope,
  Activity,
  Flame,
  Sparkles,
  CheckCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  severity: string
  read: boolean
  createdAt: string
}

const POLL_MS = 30_000

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  badge_earned: Award,
  plan_prescribed: Stethoscope,
  session_saved: Activity,
  streak_milestone: Flame,
  coach_summary: Sparkles,
  info: Bell,
}

const SEVERITY_COLOR: Record<string, string> = {
  success: 'text-emerald-500 bg-emerald-500/10',
  info: 'text-primary bg-primary/10',
  warning: 'text-amber-500 bg-amber-500/10',
  celebration: 'text-fuchsia-500 bg-fuchsia-500/10',
}

/**
 * A header bell icon with an unread-count badge and a
 * dropdown feed. Uses Server-Sent Events (SSE) for real-time delivery: a
 * persistent EventSource connection pushes new notifications the moment they're
 * created, so there's no 30s polling delay. Falls back to an initial fetch
 * on open to populate the dropdown list. Supports mark-one-read (click) and
 * mark-all-read (button).
 */
export function NotificationBell() {
  const tu = useTranslations('ui')
  const { user } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [notifications, setNotifications] = React.useState<Notification[]>([])
  const [unread, setUnread] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [live, setLive] = React.useState(false)

  const fetchNotifications = React.useCallback(async () => {
    if (!user) return
    try {
      const data = await apiFetch<{ ok: boolean; notifications: Notification[]; unreadCount: number }>(
        '/api/v2/notifications?limit=30',
      )
      if (data.ok) {
        setNotifications(data.notifications)
        setUnread(data.unreadCount)
      }
    } catch {
      /* silent, notifications are best-effort */
    }
  }, [user])

  // Real-time SSE: open a persistent EventSource that pushes new
  // notifications the moment they're created. Replaces the 30s poll.
  React.useEffect(() => {
    if (!user) return
    // Initial fetch so the badge hydrates even if SSE is slow to connect.
    void fetchNotifications()

    let es: EventSource | null = null
    try {
      es = new EventSource('/api/v2/notifications/stream')
      es.addEventListener('hello', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data)
          setUnread(data.unreadCount ?? 0)
          setLive(true)
        } catch { /* ignore */ }
      })
      es.addEventListener('notification', (ev) => {
        try {
          const n = JSON.parse((ev as MessageEvent).data) as Notification
          setNotifications((prev) =>
            prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 50),
          )
          setUnread((u) => u + 1)
        } catch { /* ignore */ }
      })
      es.onerror = () => {
        setLive(false)
        // EventSource auto-reconnects; if it fails repeatedly, the 30s
        // fallback below keeps the feed fresh.
      }
    } catch {
      // EventSource not available (SSR), the fallback poll handles it.
    }

    // Fallback poll (slower, 30s) in case SSE isn't available or drops.
    const pollId = window.setInterval(() => {
      if (!open) void fetchNotifications()
    }, POLL_MS)

    return () => {
      es?.close()
      window.clearInterval(pollId)
    }
  }, [user, fetchNotifications, open])

  // When the dropdown opens, do a fresh fetch to show the full list.
  React.useEffect(() => {
    if (open) void fetchNotifications()
  }, [open, fetchNotifications])

  const markRead = React.useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/v2/notifications/${id}/read`, { method: 'POST' })
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        )
        setUnread((u) => Math.max(0, u - 1))
      } catch {
        toast.error(tu('markReadFailed'))
      }
    },
    [],
  )

  const markAllRead = React.useCallback(async () => {
    try {
      const res = await apiFetch<{ ok: boolean; updated: number }>(
        '/api/v2/notifications',
        { method: 'POST' },
      )
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
        setUnread(0)
        toast.success(`${res.updated} notifications marked as read`)
      }
    } catch {
      toast.error(tu('markAllFailed'))
    }
  }, [])

  if (!user) return null

  return (
    <div className="relative">
      <Button
        size="icon"
        variant="ghost"
        className="relative h-9 w-9"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <>
            {/* Click-away overlay */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-black/40 backdrop-blur-xl sm:w-96"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/40 bg-muted/40 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">{tu('notifications')}</span>
                  {unread > 0 && (
                    <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-500">
                      {unread} new
                    </span>
                  )}
                  {live && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                      <span className="relative inline-flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      live
                    </span>
                  )}
                </div>
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary"
                  >
                    <CheckCheck className="h-3 w-3" />
                    {tu('markAllRead')}
                  </button>
                )}
              </div>

              {/* Feed */}
              <div className="nm-scroll-thin max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/40">
                      <Bell className="h-5 w-5 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm text-muted-foreground">{tu('noNotifications')}</p>
                    <p className="text-xs text-muted-foreground/60">
                      {tu('notifHint')}
                    </p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const Icon = TYPE_ICON[n.type] || Bell
                    const color = SEVERITY_COLOR[n.severity] || SEVERITY_COLOR.info
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (!n.read) void markRead(n.id)
                        }}
                        className={cn(
                          'flex w-full items-start gap-3 border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/30',
                          !n.read && 'bg-primary/5',
                        )}
                      >
                        <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex flex-1 flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">{n.title}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/70">
                              {timeAgo(n.createdAt)}
                            </span>
                          </div>
                          {n.body && (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">{n.body}</p>
                          )}
                        </div>
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="unread" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-border/40 px-4 py-2 text-center">
                <span className="text-[10px] text-muted-foreground/60">
                  Updates every 30s · click an item to mark it read
                </span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const sec = Math.round((d.getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' })
  const abs = Math.abs(sec)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 604800) return rtf.format(Math.round(sec / 86400), 'day')
  return d.toLocaleDateString(document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-GB', { day: '2-digit', month: 'short' })
}
