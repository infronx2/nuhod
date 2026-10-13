'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Moon, Sun, Languages, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WsConnectionState } from '@/components/nuhoud/types'
import { UserMenu } from '@/components/nuhoud/user-menu'
import { NotificationBell } from '@/components/nuhoud/notification-bell'
import { useAuth } from '@/hooks/use-auth'

interface HeaderProps {
  /** WS connection state. Omit / pass undefined to hide the WS pill entirely. */
  connection?: WsConnectionState
  /** Legacy prop — kept for backward compatibility but no longer used. */
  rtl?: boolean
  /** Legacy callback — kept for backward compatibility but no longer used. */
  onToggleRtl?: () => void
}

function NuhoudLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Nuhoud neuron-joint logo"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
        <path d="M32 4 L32 12" />
        <path d="M52 16 L46 21" />
        <path d="M60 32 L52 32" />
        <path d="M52 48 L46 43" />
        <path d="M32 60 L32 52" />
        <path d="M12 48 L18 43" />
        <path d="M4 32 L12 32" />
        <path d="M12 16 L18 21" />
      </g>
      <circle cx="32" cy="32" r="6" fill="currentColor" />
      <path d="M20 40 Q32 50 44 36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <circle cx="20" cy="40" r="3" fill="currentColor" />
      <circle cx="44" cy="36" r="3" fill="currentColor" />
    </svg>
  )
}

/**
 * Header — sticky top bar with brand, language toggle, theme toggle, WS
 * status, notification bell, and user menu. Uses next-intl's useLocale +
 * useTranslations for full Arabic/English bilingual support. The language
 * toggle switches the locale cookie via /api/v2/locale then reloads.
 */
export function Header({ connection, rtl: _rtl, onToggleRtl: _onToggleRtl }: HeaderProps = {}) {
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()
  const t = useTranslations('header')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [mounted, setMounted] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const isRTL = locale === 'ar'

  const statusColor: Record<WsConnectionState, string> = {
    Disconnected: 'bg-rose-500',
    Connecting: 'bg-amber-500',
    Connected: 'bg-emerald-500',
  }
  const statusLabel: Record<WsConnectionState, string> = {
    Disconnected: tc('disconnected'),
    Connecting: tc('connecting'),
    Connected: tc('connected'),
  }

  const handleToggleLanguage = async () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar'
    setSwitching(true)
    try {
      await fetch('/api/v2/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      })
      // Reload to apply the new locale + direction.
      window.location.reload()
    } catch {
      setSwitching(false)
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-border/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/70',
        // Gradient — uses logical direction (to-l for RTL, to-r for LTR)
        isRTL
          ? 'bg-gradient-to-l from-slate-50 via-background to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950'
          : 'bg-gradient-to-r from-slate-50 via-background to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950',
      )}
    >
      {/* Radial primary glow behind the logo — positioned on the start side */}
      <div
        className="pointer-events-none absolute top-1/2 h-24 w-24 -translate-y-1/2 rounded-full opacity-40 blur-2xl start-2 sm:start-6"
        style={{
          background: 'radial-gradient(circle at center, rgba(11,83,148,0.45), transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ rotate: -8, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="text-primary"
          >
            <NuhoudLogo className="h-9 w-9 sm:h-10 sm:w-10" />
          </motion.div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-foreground sm:text-lg">
              {t('brandName')}
            </span>
            <span className="text-[10px] leading-tight text-muted-foreground sm:text-xs">
              {t('brandSubtitle')}
            </span>
          </div>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {!user && (
            <Badge
              variant="outline"
              className="hidden gap-1.5 border-border/60 px-2.5 py-1 text-xs font-medium sm:inline-flex"
            >
              <span className="text-foreground">{t('welcomeText')}</span>
            </Badge>
          )}

          {/* Language toggle — switches between Arabic and English */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleLanguage}
            disabled={switching}
            className="h-9 gap-1.5 px-3 text-xs"
            aria-label={t('toggleLanguage')}
          >
            {switching ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Languages className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isRTL ? 'EN' : 'عربي'}</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-muted-foreground">{isRTL ? 'عربي' : 'EN'}</span>
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t('toggleDarkMode')}
          >
            {mounted ? (
              theme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )
            ) : (
              <Sun className="h-4 w-4 opacity-50" aria-hidden="true" />
            )}
          </Button>

          {user && connection && (
            <div
              className="hidden items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs font-medium md:inline-flex"
              role="status"
              aria-live="polite"
            >
              <span className="relative inline-flex h-2.5 w-2.5">
                <span
                  className={cn('inline-flex h-2.5 w-2.5 rounded-full', statusColor[connection])}
                />
                {connection === 'Connecting' && (
                  <span className="absolute inset-0 inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-amber-500/60" />
                )}
              </span>
              <span className="text-foreground/90">{statusLabel[connection]}</span>
              {connection === 'Disconnected' ? (
                <WifiOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              ) : connection === 'Connecting' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              )}
            </div>
          )}

          {user && <NotificationBell />}
          {user && <UserMenu />}
        </div>
      </div>
    </header>
  )
}
