'use client'

import * as React from 'react'
import { Moon, Sun, Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/nuhoud/user-menu'
import { NotificationBell } from '@/components/nuhoud/notification-bell'
import { NeuronMark } from '@/components/nuhoud/neuron-mark'
import { useAuth } from '@/hooks/use-auth'

/**
 * Header — sticky bar: brand, language switch, theme switch, notifications and the user menu.
 * The language switch stores the locale cookie via /api/v2/locale, then reloads.
 */
export function Header() {
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()
  const t = useTranslations('header')
  const locale = useLocale()
  const [mounted, setMounted] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const handleToggleLanguage = async () => {
    setSwitching(true)
    try {
      await fetch('/api/v2/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: locale === 'ar' ? 'en' : 'ar' }),
      })
      window.location.reload()
    } catch {
      setSwitching(false)
    }
  }

  return (
    <header className="nm-glass sticky top-0 z-40 w-full border-b border-border/70">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <NeuronMark className="h-8 w-8 text-primary" />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold text-foreground">{t('brandName')}</span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">{t('brandSubtitle')}</span>
          </div>
        </div>

        <div className="ms-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleLanguage}
            disabled={switching}
            className="h-9 px-3 text-sm font-medium"
            aria-label={t('toggleLanguage')}
          >
            {switching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : locale === 'ar' ? 'English' : 'العربية'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t('toggleDarkMode')}
          >
            {mounted && theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </Button>
          {user && <NotificationBell />}
          {user && <UserMenu />}
        </div>
      </div>
    </header>
  )
}
