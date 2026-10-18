'use client'

import * as React from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowDownRight, ArrowRight, ArrowUpRight, Pencil, RotateCw, Search, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { V2PatientStatus, V2PatientSummary } from '@/lib/v2-types'
import { GradientAvatar } from '@/components/nuhoud/gradient-avatar'

interface PatientRosterTableProps {
  patients: V2PatientSummary[]
  loading: boolean
  onView: (patientId: string) => void
  onEditPlan: (patient: V2PatientSummary) => void
  onRefresh: () => void
}

const STATUS_ORDER: Record<V2PatientStatus, number> = { attention: 0, improving: 1, stable: 2, new: 3 }

const STATUS_STYLE: Record<V2PatientStatus, { dot: string; text: string; key: string }> = {
  improving: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', key: 'statusImproving' },
  stable: { dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', key: 'statusStable' },
  attention: { dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', key: 'statusAttention' },
  new: { dot: 'bg-slate-400', text: 'text-muted-foreground', key: 'statusNew' },
}

function statusOf(p: V2PatientSummary): V2PatientStatus {
  return p.indicators?.status ?? (p.sessionsCount === 0 ? 'new' : 'stable')
}

/**
 * PatientRosterTable — every patient on one screen, sorted so the ones needing attention come
 * first. Status, ROM trend and compensation come from GET /api/v2/patients (indicators).
 */
export function PatientRosterTable({ patients, loading, onView, onEditPlan, onRefresh }: PatientRosterTableProps) {
  const t = useTranslations('roster')
  const locale = useLocale()
  const [search, setSearch] = React.useState('')

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return patients
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .sort((a, b) => {
        const byStatus = STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)]
        if (byStatus !== 0) return byStatus
        return (b.latestSession?.sessionDate ?? '').localeCompare(a.latestSession?.sessionDate ?? '')
      })
  }, [patients, search])

  const attention = patients.filter((p) => statusOf(p) === 'attention').length
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB', { day: 'numeric', month: 'short' })

  return (
    <Card className="border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('subtitle', { count: patients.length, attention })}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('legend')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 start-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              className="h-9 w-56 ps-8 text-xs"
              aria-label={t('search')}
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onRefresh}>
            <RotateCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {loading && patients.length === 0 ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
          <Users className="h-10 w-10 opacity-40" />
          <p className="text-sm">{search ? t('noMatch') : t('empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start text-xs">{t('colPatient')}</TableHead>
                <TableHead className="text-start text-xs">{t('colStatus')}</TableHead>
                <TableHead className="text-start text-xs">{t('colRom')}</TableHead>
                <TableHead className="text-start text-xs">{t('colComp')}</TableHead>
                <TableHead className="text-start text-xs">{t('colGrip')}</TableHead>
                <TableHead className="text-start text-xs">{t('colPlan')}</TableHead>
                <TableHead className="text-start text-xs">{t('colLast')}</TableHead>
                <TableHead className="text-end text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const status = statusOf(p)
                const style = STATUS_STYLE[status]
                const ind = p.indicators
                const trend = ind?.romTrend ?? null
                const compPct = Math.round((ind?.compensationRate ?? 0) * 100)
                const assistPct = Math.round((ind?.assistedRate ?? 0) * 100)
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer text-sm"
                    onClick={() => onView(p.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <GradientAvatar seed={p.avatarSeed} name={p.name} size="h-9 w-9" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground" dir="ltr">{p.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className={cn('inline-flex items-center gap-2 text-xs font-semibold', style.text)}>
                          <span className={cn('h-2.5 w-2.5 rounded-full', style.dot)} aria-hidden="true" />
                          {t(style.key)}
                        </span>
                        {(ind?.painStops ?? 0) > 0 && (
                          <Badge variant="destructive" className="w-fit px-1.5 py-0 text-[10px]">
                            {t('painStops', { count: ind!.painStops })}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {trend === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 font-mono text-xs font-semibold',
                            trend >= 2 ? 'text-emerald-600 dark:text-emerald-400' : trend <= -5 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                          )}
                          dir="ltr"
                        >
                          {trend >= 2 ? <ArrowUpRight className="h-3.5 w-3.5" /> : trend <= -5 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                          {trend > 0 ? '+' : ''}{trend.toFixed(1)}°
                        </span>
                      )}
                      {p.latestSession && (
                        <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                          {t('maxShort', { angle: p.latestSession.maxAchievedAngle.toFixed(0) })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {compPct === 0 && assistPct === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5 font-mono">
                          {compPct > 0 && (
                            <span className={cn(compPct >= 20 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-muted-foreground')} dir="ltr">
                              {compPct}%
                            </span>
                          )}
                          {assistPct > 0 && (
                            <span className={cn(assistPct >= 50 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                              {t('assisted', { pct: assistPct })}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {ind?.bestGrip ? `${ind.bestGrip}%` : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.activePlan ? (
                        <span className="font-mono">{t('planShort', { angle: p.activePlan.targetAngle, reps: p.activePlan.dailyRepGoal })}</span>
                      ) : (
                        <span className="text-muted-foreground">{t('noPlan')}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {p.latestSession ? formatDate(p.latestSession.sessionDate) : t('never')}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditPlan(p)
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          {t('editPlan')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs text-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            onView(p.id)
                          }}
                        >
                          {t('view')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
