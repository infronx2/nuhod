'use client'

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Search, Dumbbell, Activity, Flame, ChevronRight, Stethoscope } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

interface ExercisePreset {
  id: string
  slug: string
  name: string
  nameAr: string | null
  description: string
  joint: string
  limb: string
  targetAngle: number
  difficulty: string
  sessionsPerWeek: number
}

const DIFFICULTY_META: Record<string, { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  beginner: { color: 'text-accent-foreground', bg: 'bg-accent border-transparent', icon: Activity },
  intermediate: { color: 'text-primary', bg: 'bg-primary/10 border-transparent', icon: Flame },
  advanced: { color: 'text-[#B5541B] dark:text-[#F0B070]', bg: 'bg-[#E8A15C]/15 border-transparent', icon: Dumbbell },
}

const JOINT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  elbow: Dumbbell,
  shoulder: Activity,
  wrist: Flame,
}

/**
 * ExerciseLibrary — a searchable, filterable grid of the clinical exercise
 * preset library. Each preset shows its name (EN + Arabic), description,
 * difficulty badge, target-angle viz, joint + limb, and a "prescribe"
 * shortcut for doctors. Used as a dedicated section on the doctor dashboard.
 */
export function ExerciseLibrary({ onPrescribe }: { onPrescribe?: (preset: ExercisePreset) => void }) {
  const tu = useTranslations('ui')
  const ar = useLocale() === 'ar'
  const [presets, setPresets] = React.useState<ExercisePreset[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [difficultyFilter, setDifficultyFilter] = React.useState<string | null>(null)
  const [jointFilter, setJointFilter] = React.useState<string | null>(null)

  React.useEffect(() => {
    apiFetch<{ ok: boolean; presets: ExercisePreset[] }>('/api/v2/exercises')
      .then((d) => { if (d.ok) setPresets(d.presets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = React.useMemo(() => {
    return presets.filter((p) => {
      if (difficultyFilter && p.difficulty !== difficultyFilter) return false
      if (jointFilter && p.joint !== jointFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) ||
          (p.nameAr?.includes(search)) ||
          p.description.toLowerCase().includes(q) ||
          p.slug.includes(q)
      }
      return true
    })
  }, [presets, search, difficultyFilter, jointFilter])

  const difficulties = ['beginner', 'intermediate', 'advanced']
  const joints = ['elbow', 'shoulder', 'wrist']

  return (
    <Card className="nm-glass border-border/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{tu('exLibrary')}</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {tu('presetCount', { n: filtered.length, total: presets.length })}
        </span>
      </div>

      {/* Search + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tu('searchEx')}
            className="h-8 w-full pl-8 text-xs"
            aria-label="Search exercises"
          />
        </div>
        {/* Difficulty pills */}
        <div className="flex gap-1">
          {difficulties.map((d) => {
            const meta = DIFFICULTY_META[d] ?? DIFFICULTY_META.beginner
            const Icon = meta.icon
            const active = difficultyFilter === d
            return (
              <button
                key={d}
                onClick={() => setDifficultyFilter(active ? null : d)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium capitalize transition-colors',
                  active ? meta.bg + ' ' + meta.color : 'border-border/40 text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-2.5 w-2.5" />
                {tu(`diff_${d}`)}
              </button>
            )
          })}
        </div>
        {/* Joint filter */}
        <div className="flex gap-1">
          {joints.map((j) => {
            const active = jointFilter === j
            return (
              <button
                key={j}
                onClick={() => setJointFilter(active ? null : j)}
                className={cn(
                  'rounded-full border px-2 py-1 text-[10px] font-medium capitalize transition-colors',
                  active ? 'bg-primary/15 border-primary/40 text-primary' : 'border-border/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {tu(`joint_${j}`)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{tu('noExMatch')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p, i) => {
            const diffMeta = DIFFICULTY_META[p.difficulty] ?? DIFFICULTY_META.beginner
            const DiffIcon = diffMeta.icon
            const JointIcon = JOINT_ICON[p.joint] ?? Dumbbell
            return (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
                whileHover={{ y: -2 }}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border border-border/40 bg-card/60 p-3 transition-colors',
                  'hover:border-primary/40 hover:bg-primary/5',
                )}
              >
                {/* Top row: joint icon + difficulty badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <JointIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground">{tu(`joint_${p.joint}`)}</span>
                  </div>
                  <Badge className={cn('gap-1 border px-1.5 py-0.5 text-[9px] font-medium', diffMeta.bg, diffMeta.color)} variant="outline">
                    <DiffIcon className="h-2.5 w-2.5" />
                    {tu(`diff_${p.difficulty}`)}
                  </Badge>
                </div>

                {/* Name */}
                <div>
                  <p className="text-sm font-semibold text-foreground">{ar && p.nameAr ? p.nameAr : p.name}</p>
                </div>

                {/* Description (English only: the presets have no Arabic description) */}
                {!ar && <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{p.description}</p>}

                {/* Target angle viz */}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <div className="relative h-8 w-8">
                      <svg viewBox="0 0 32 32" className="h-full w-full">
                        <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/30" />
                        <circle
                          cx="16"
                          cy="16"
                          r="13"
                          fill="none"
                          stroke="var(--primary)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeDasharray={`${(p.targetAngle / 180) * 81.68} 81.68`}
                          transform="rotate(-90 16 16)"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold text-primary">
                        {p.targetAngle}°
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{tu('perWeek', { n: p.sessionsPerWeek })}</span>
                  </div>

                  {/* Prescribe shortcut (for doctors) */}
                  {onPrescribe && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[10px] text-primary hover:bg-primary/10"
                      onClick={() => onPrescribe(p)}
                    >
                      <Stethoscope className="h-2.5 w-2.5" />
                      {tu('prescribe')}
                      <ChevronRight className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
