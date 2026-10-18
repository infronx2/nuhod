'use client'

import * as React from 'react'
import { HeartPulse } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface FooterProps {
  /** Legacy prop — RTL is now determined by locale automatically. */
  rtl?: boolean
}

export function Footer({ rtl: _rtl }: FooterProps) {
  const t = useTranslations('footer')
  return (
    <footer
      className="mt-auto w-full border-t border-border/60 bg-background/80 px-4 py-5 backdrop-blur sm:px-6 lg:px-8"
      aria-label="Site footer"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <HeartPulse className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="font-semibold text-foreground">نُهوض</span>
            <span className="opacity-60">·</span>
            <span>{t('builtFor')}</span>
          </div>
        </div>
        <p className="text-right">
          {t('disclaimer')}
        </p>
        <p className="text-[10px] text-muted-foreground/70 text-right">
          {t('copyright')}
        </p>
      </div>
    </footer>
  )
}
