'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Loader2, Minus, Plus, Save } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { apiFetch } from '@/lib/api'

type TargetLimb = 'upper_right' | 'upper_left' | 'bilateral'

export interface PlanEditorPatient {
  id: string
  name: string
  affectedSide?: string
}

export interface PlanEditorPlan {
  targetAngle: number
  dailyRepGoal: number
  sessionsPerWeek: number
  targetLimb: string
  notes?: string | null
}

interface PlanEditorDialogProps {
  patient: PlanEditorPatient | null
  /** The plan to start from; null starts from the clinic defaults. */
  plan: PlanEditorPlan | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

const DEFAULTS = { targetAngle: 45, dailyRepGoal: 10, sessionsPerWeek: 5 }

function limbFrom(plan: PlanEditorPlan | null, side?: string): TargetLimb {
  const limb = plan?.targetLimb
  if (limb === 'upper_left' || limb === 'upper_right' || limb === 'bilateral') return limb
  return side === 'left' ? 'upper_left' : side === 'bilateral' ? 'bilateral' : 'upper_right'
}

/**
 * PlanEditorDialog — the doctor sets what the majlis game asks of a patient: the arm elevation
 * the targets sit at, how many tasks end a session, and which hand is tracked. Saving creates a
 * new plan that replaces the active one (POST /api/v2/patients/[id]/plans).
 */
export function PlanEditorDialog({ patient, plan, open, onOpenChange, onSaved }: PlanEditorDialogProps) {
  const t = useTranslations('planEditor')
  const [angle, setAngle] = React.useState(DEFAULTS.targetAngle)
  const [reps, setReps] = React.useState(DEFAULTS.dailyRepGoal)
  const [perWeek, setPerWeek] = React.useState(DEFAULTS.sessionsPerWeek)
  const [limb, setLimb] = React.useState<TargetLimb>('upper_right')
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Start from the patient's current plan every time the dialog opens.
  React.useEffect(() => {
    if (!open) return
    setAngle(plan?.targetAngle ?? DEFAULTS.targetAngle)
    setReps(plan?.dailyRepGoal ?? DEFAULTS.dailyRepGoal)
    setPerWeek(plan?.sessionsPerWeek ?? DEFAULTS.sessionsPerWeek)
    setLimb(limbFrom(plan, patient?.affectedSide))
    setNotes(plan?.notes ?? '')
  }, [open, plan, patient?.affectedSide])

  const save = async () => {
    if (!patient) return
    setSaving(true)
    try {
      await apiFetch(`/api/v2/patients/${patient.id}/plans`, {
        method: 'POST',
        json: {
          title: `Majlis plan · ${angle}° · ${reps} tasks a day`,
          targetAngle: angle,
          dailyRepGoal: reps,
          sessionsPerWeek: perWeek,
          targetLimb: limb,
          notes: notes.trim() || undefined,
        },
      })
      toast.success(t('saved'))
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      toast.error(t('failed'), { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title', { name: patient?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <Label>{t('targetAngle')}</Label>
              <span className="font-mono text-3xl font-bold tabular-nums text-primary" dir="ltr">
                {angle}°
              </span>
            </div>
            <Slider
              value={[angle]}
              min={20}
              max={160}
              step={5}
              onValueChange={(v) => setAngle(v[0] ?? angle)}
              aria-label={t('targetAngle')}
            />
            <p className="text-xs text-muted-foreground">{t('targetAngleHint')}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stepper label={t('dailyReps')} hint={t('dailyRepsHint')} value={reps} min={1} max={60} onChange={setReps} />
            <Stepper label={t('sessionsPerWeek')} value={perWeek} min={1} max={14} onChange={setPerWeek} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('limb')}</Label>
            <ToggleGroup
              type="single"
              value={limb}
              onValueChange={(v) => v && setLimb(v as TargetLimb)}
              variant="outline"
              className="grid w-full grid-cols-3"
            >
              <ToggleGroupItem value="upper_right" className="h-10">{t('limbRight')}</ToggleGroupItem>
              <ToggleGroupItem value="upper_left" className="h-10">{t('limbLeft')}</ToggleGroupItem>
              <ToggleGroupItem value="bilateral" className="h-10">{t('limbBoth')}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="plan-notes">{t('notes')}</Label>
            <Textarea
              id="plan-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving || !patient} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-1" dir="ltr">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`${label} −`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="font-mono text-xl font-bold tabular-nums">{value}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`${label} +`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
