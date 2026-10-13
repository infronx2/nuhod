'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { WsCommand } from '@/components/nuhoud/types'

interface CommandBannerProps {
  command: WsCommand
}

const CONFIG: Record<WsCommand, {
  bg: string; border: string; text: string; dot: string; animate?: 'pulse' | 'shake' | 'none'
}> = {
  KEEP_GOING: { bg: 'bg-primary/10', border: 'border-primary/40', text: 'text-primary', dot: 'bg-primary', animate: 'none' },
  HOLD: { bg: 'bg-amber-500/10', border: 'border-amber-500/40', text: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-500', animate: 'none' },
  TARGET_HIT: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/50', text: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500', animate: 'pulse' },
  CORRECT_POSTURE: { bg: 'bg-rose-500/15', border: 'border-rose-500/50', text: 'text-rose-600 dark:text-rose-300', dot: 'bg-rose-500', animate: 'shake' },
  NO_POSE: { bg: 'bg-muted/50', border: 'border-border/60', text: 'text-muted-foreground', dot: 'bg-muted-foreground', animate: 'none' },
}

export function CommandBanner({ command }: CommandBannerProps) {
  const t = useTranslations('commands')
  const cfg = CONFIG[command]
  const titleKey = command as string
  return (
    <div className={cn('flex w-full items-center gap-3 rounded-lg border p-4', cfg.bg, cfg.border)} role="status" aria-live="assertive">
      <AnimatePresence mode="wait">
        <motion.div
          key={command}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={cfg.animate === 'pulse' ? { opacity: 1, scale: [1, 1.04, 1] } : cfg.animate === 'shake' ? { opacity: 1, x: [0, -4, 4, -4, 0] } : { opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={cfg.animate === 'pulse' ? { duration: 0.6, repeat: Infinity, repeatDelay: 0.6 } : { duration: 0.3 }}
          className="flex w-full items-center gap-3"
        >
          <span className={cn('h-3 w-3 shrink-0 rounded-full', cfg.dot)} aria-hidden="true" />
          <div className="flex flex-col">
            <span className={cn('text-sm font-bold tracking-wide', cfg.text)}>
              {t(titleKey)}
            </span>
            <span className={cn('text-xs leading-snug', cfg.text, 'opacity-90')}>
              {t(`${titleKey}Desc` as 'KEEP_GOINGDesc')}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
