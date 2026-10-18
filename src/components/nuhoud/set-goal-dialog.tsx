'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Target, Loader2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

interface SetGoalDialogProps {
  patientId: string
  patientName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

const GOAL_TYPES = [
  { value: 'rom_target', label: 'ROM target (°)', min: 30, max: 180, default: 120, unit: '°', description: 'Reach a specific elbow flexion angle' },
  { value: 'rep_count', label: 'Rep count', min: 5, max: 200, default: 50, unit: ' reps', description: 'Complete a total number of reps in one session' },
  { value: 'accuracy', label: 'Accuracy (%)', min: 50, max: 100, default: 90, unit: '%', description: 'Reach a target accuracy percentage' },
]

/**
 * SetGoalDialog — a doctor-facing dialog for creating a rehabilitation goal
 * for a patient. Lets the doctor pick the goal type (ROM, reps, accuracy,
 * streak), set a target value via a slider, and optionally add a title.
 * On submit, POSTs to /api/v2/goals and toasts the result.
 */
export function SetGoalDialog({ patientId, patientName, open, onOpenChange, onCreated }: SetGoalDialogProps) {
  const tu = useTranslations('ui')
  const [type, setType] = React.useState('rom_target')
  const [targetValue, setTargetValue] = React.useState(120)
  const [title, setTitle] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const typeMeta = GOAL_TYPES.find((t) => t.value === type) ?? GOAL_TYPES[0]

  // When the type changes, reset the target to that type's default.
  const handleTypeChange = (newType: string) => {
    setType(newType)
    const meta = GOAL_TYPES.find((t) => t.value === newType)
    if (meta) setTargetValue(meta.default)
    setTitle('')
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const finalTitle = title.trim() || `Reach ${targetValue}${typeMeta.unit} ${typeMeta.label.split(' ')[0]}`
      await apiFetch('/api/v2/goals', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          type,
          title: finalTitle,
          targetValue,
        }),
      })
      toast.success(tu('goalCreated'), {
        description: `"${finalTitle}" for ${patientName ?? 'patient'}.`,
      })
      onOpenChange(false)
      setTitle('')
      onCreated?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      toast.error(tu('goalCreateFailed'), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {tu('setGoalTitle')}
          </DialogTitle>
          <DialogDescription>
            Create a milestone goal for {patientName ?? 'this patient'}. They'll see it on their dashboard with a progress tracker.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Goal type */}
          <div className="space-y-1.5">
            <Label htmlFor="goal-type" className="text-xs font-medium">{tu('goalType')}</Label>
            <Select value={type ?? ''} onValueChange={handleTypeChange}>
              <SelectTrigger id="goal-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{typeMeta.description}</p>
          </div>

          {/* Target value */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">{tu('targetValue')}</Label>
              <span className="font-mono text-sm font-bold text-primary">
                {targetValue}{typeMeta.unit}
              </span>
            </div>
            <Slider
              value={[targetValue]}
              min={typeMeta.min}
              max={typeMeta.max}
              step={type === 'accuracy' ? 1 : 5}
              onValueChange={(v) => setTargetValue(v[0])}
              className="py-1"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/70">
              <span>{typeMeta.min}{typeMeta.unit}</span>
              <span>{typeMeta.max}{typeMeta.unit}</span>
            </div>
          </div>

          {/* Title (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="goal-title" className="text-xs font-medium">{tu('titleOptional')}</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Reach ${targetValue}${typeMeta.unit} ...`}
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {tu('cancel')}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-primary text-white hover:bg-primary/90"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {tu('createGoal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
