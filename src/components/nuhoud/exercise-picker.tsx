'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Dumbbell, Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiFetch } from '@/lib/api'
import type { V2ExercisePreset, V2ExercisesResponse } from '@/lib/v2-types'

export interface ExercisePickerValue {
  /** 'custom' or a preset slug. */
  slug: string
  targetAngle: number
  limb: 'right' | 'left'
  description?: string | null
  difficulty?: string | null
}

interface ExercisePickerProps {
  value: ExercisePickerValue
  onChange: (next: ExercisePickerValue) => void
  className?: string
}

/**
 * ExercisePicker — dropdown of clinical exercise presets fetched from
 * /api/v2/exercises. Selecting a preset sets the target angle + limb
 * automatically and shows the preset's description. The 'custom' option
 * keeps the manual slider behavior.
 */
export function ExercisePicker({ value, onChange, className }: ExercisePickerProps) {
  const tu = useTranslations('ui')
  const [presets, setPresets] = React.useState<V2ExercisePreset[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<V2ExercisesResponse>('/api/v2/exercises')
      .then((data) => {
        if (cancelled) return
        setPresets(data.presets ?? [])
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load presets')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSelect = (slug: string) => {
    if (slug === 'custom') {
      onChange({
        slug: 'custom',
        targetAngle: value.targetAngle,
        limb: value.limb,
        description: null,
        difficulty: null,
      })
      return
    }
    const preset = presets.find((p) => p.slug === slug)
    if (!preset) return
    onChange({
      slug: preset.slug,
      targetAngle: preset.targetAngle,
      limb: (preset.limb === 'left' ? 'left' : 'right'),
      description: preset.description,
      difficulty: preset.difficulty,
    })
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs">
        <label htmlFor="exercise-select" className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Dumbbell className="h-3.5 w-3.5" />
          {tu('exPreset')}
        </label>
        {value.difficulty && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {value.difficulty}
          </span>
        )}
      </div>
      <Select value={value.slug ?? ''} onValueChange={handleSelect} disabled={loading}>
        <SelectTrigger id="exercise-select" className="h-9 w-full text-xs" aria-label="Exercise preset selection">
          <SelectValue placeholder={loading ? 'Loading…' : 'Select exercise'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="custom">{tu('customSlider')}</SelectItem>
          {presets.map((p) => (
            <SelectItem key={p.slug} value={p.slug}>
              <span className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {p.targetAngle}° · {p.limb}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading presets…
        </div>
      )}
      {error && (
        <div className="mt-1 text-[10px] text-rose-500">
          Could not load presets: {error}
        </div>
      )}
      {value.slug !== 'custom' && value.description && (
        <p className="mt-1.5 rounded-md border border-border/40 bg-muted/20 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {value.description}
        </p>
      )}
    </div>
  )
}
