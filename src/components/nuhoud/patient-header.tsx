'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import {
  Target,
  Calendar,
  Activity,
  ClipboardList,
  Stethoscope,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { V2TreatmentPlan, V2Stats } from '@/lib/v2-types'

interface PatientHeaderProps {
  plan: V2TreatmentPlan | null
  /** Used for the "reps today vs daily goal" progress bar. */
  todayReps?: number
  stats?: V2Stats | null
  loading?: boolean
}

/**
 * PatientHeader — لافتة بارزة تعرض خطة المريض العلاجية الحالية (العنوان،
 * الزاوية المستهدفة، الجلسات/الأسبوع، الهدف اليومي، الطبيب الواصف) مع شريط
 * تقدّم لتكرارات اليوم مقابل الهدف اليومي.
 *
 * مثال على استخدام `useTranslations` من next-intl: كل النصوص تأتي من
 * `messages/ar.json` تحت نطاق `patient`. يسمح النمط `t('key')` بتبديل اللغة
 * لاحقاً بسهولة دون تعديل الكود.
 */
export function PatientHeader({ plan, todayReps = 0, loading }: PatientHeaderProps) {
  const t = useTranslations('patient')

  if (loading && !plan) {
    return (
      <Card className="border-border/40 bg-card/60 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
        <Skeleton className="h-24 w-full" />
      </Card>
    )
  }

  if (!plan) {
    return (
      <Card className="border-dashed border-border/60 bg-card/40 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            {t('noActivePlan')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('noActivePlanDesc')}
          </p>
        </div>
      </Card>
    )
  }

  const dailyGoal = Math.max(1, plan.dailyRepGoal)
  const pct = Math.min(100, Math.round((todayReps / dailyGoal) * 100))
  const limbLabel =
    plan.targetLimb === 'upper_left'
      ? t('leftLimb')
      : plan.targetLimb === 'bilateral'
        ? t('bilateral')
        : t('rightLimb')

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative overflow-hidden border-border/40 bg-gradient-to-bl from-primary/10 via-card/60 to-emerald-500/5 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
        {/* توهج شعاعي خفيف */}
        <div
          className="pointer-events-none absolute -top-12 -left-12 h-48 w-48 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              'radial-gradient(circle at center, rgba(11, 83, 148,0.5), transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-primary dark:text-primary">
                  {t('activePlan')}
                </span>
              </div>
              <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
                {plan.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                  <Stethoscope className="h-3 w-3" />
                  {plan.doctor?.name ?? t('prescribedBy')}
                </Badge>
                <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                  {limbLabel}
                </Badge>
                {plan.notes && (
                  <Badge variant="outline" className="gap-1 border-border/60 px-2 py-0.5 font-normal">
                    <ClipboardList className="h-3 w-3" />
                    {t('notes')}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <PlanStat icon={Target} label={t('target')} value={`${plan.targetAngle}°`} accent="text-primary" />
              <PlanStat icon={Calendar} label={t('sessionsPerWeek')} value={plan.sessionsPerWeek} accent="text-primary" />
              <PlanStat icon={Activity} label={t('dailyRepGoal')} value={plan.dailyRepGoal} accent="text-emerald-500" />
            </div>
          </div>

          {plan.notes && (
            <p className="rounded-md border border-border/40 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
              {plan.notes}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">{t('repsToday')}</span>
              <span className="font-mono font-semibold">
                <span className={cn(pct >= 100 ? 'text-emerald-500' : 'text-foreground')}>
                  {todayReps}
                </span>
                <span className="text-muted-foreground"> / {plan.dailyRepGoal}</span>
                <span className="ms-2 text-muted-foreground">{pct}%</span>
              </span>
            </div>
            {/* استخدام ps/pe (logical properties) بدل pl/pr ليدعم RTL تلقائياً */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  pct >= 100
                    ? 'bg-gradient-to-l from-emerald-500 to-primary'
                    : 'bg-gradient-to-l from-primary to-emerald-500',
                )}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            {pct >= 100 && (
              <div className="text-xs font-medium text-emerald-500">
                ✓ {t('goalReached')}
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

function PlanStat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  accent: string
}) {
  return (
    <div className="flex min-w-[88px] flex-col gap-0.5 rounded-lg border border-border/40 bg-card/60 px-3 py-2 backdrop-blur">
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className={cn('font-mono text-lg font-bold', accent)}>{value}</span>
    </div>
  )
}
