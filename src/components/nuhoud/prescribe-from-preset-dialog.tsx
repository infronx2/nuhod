'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Stethoscope, Loader2, Plus, User } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { GradientAvatar } from '@/components/nuhoud/gradient-avatar'
import { cn } from '@/lib/utils'
import type { V2PatientSummary } from '@/lib/v2-types'

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

interface PrescribeFromPresetDialogProps {
  preset: ExercisePreset | null
  patients: V2PatientSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPrescribed?: () => void
}

/**
 * PrescribeFromPresetDialog — when a doctor clicks "Prescribe" on an exercise
 * preset from the ExerciseLibrary, this dialog opens. It lets the doctor:
 *  1. Pick a patient from the roster (with avatar + name + affected side).
 *  2. Review the pre-filled target angle (from the preset) via a slider.
 *  3. Set sessions/week + daily rep goal.
 *  4. POST to /api/v2/patients/[id]/plans.
 *
 * The preset's targetAngle + limb are pre-filled, saving the doctor from
 * re-entering clinical parameters.
 */
export function PrescribeFromPresetDialog({
  preset,
  patients,
  open,
  onOpenChange,
  onPrescribed,
}: PrescribeFromPresetDialogProps) {
  const tu = useTranslations('ui')
  const [patientId, setPatientId] = React.useState<string>('')
  const [targetAngle, setTargetAngle] = React.useState(90)
  const [sessionsPerWeek, setSessionsPerWeek] = React.useState(5)
  const [dailyRepGoal, setDailyRepGoal] = React.useState(20)
  const [saving, setSaving] = React.useState(false)

  // Pre-fill from the preset when it changes.
  React.useEffect(() => {
    if (preset) {
      setTargetAngle(preset.targetAngle)
      setSessionsPerWeek(preset.sessionsPerWeek)
      // Default the patient to the first one if not set.
      if (!patientId && patients.length > 0) setPatientId(patients[0].id)
    }
  }, [preset, patients, patientId])

  const handleSubmit = async () => {
    if (!patientId || !preset) return
    setSaving(true)
    try {
      await apiFetch(`/api/v2/patients/${patientId}/plans`, {
        method: 'POST',
        body: JSON.stringify({
          title: document.documentElement.lang === 'ar' && preset.nameAr ? `خطة ${preset.nameAr}` : `${preset.name} plan`,
          targetLimb: preset.limb === 'left' ? 'upper_left' : 'upper_right',
          targetAngle,
          sessionsPerWeek,
          dailyRepGoal,
        }),
      })
      const patient = patients.find((p) => p.id === patientId)
      toast.success(tu('planPrescribed'), {
        description: `"${preset.name}" → ${patient?.name ?? 'patient'} (target ${targetAngle}°).`,
      })
      onOpenChange(false)
      onPrescribed?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      toast.error(tu('planPrescribeFailed'), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  if (!preset) return null
  const selectedPatient = patients.find((p) => p.id === patientId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            {tu('prescribePlanTitle')}
          </DialogTitle>
          <DialogDescription>
            {tu('prescribeDesc', { name: (document.documentElement.lang === 'ar' && preset.nameAr) || preset.name })}
          </DialogDescription>
        </DialogHeader>

        {/* Preset summary */}
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">{preset.name}</span>
            {preset.nameAr && (
              <span className="text-[10px] text-muted-foreground" dir="rtl">{preset.nameAr}</span>
            )}
          </div>
          <div className="ml-auto flex gap-1">
            <Badge variant="outline" className="border-primary/40 text-primary text-[9px]">
              {preset.targetAngle}°
            </Badge>
            <Badge variant="outline" className="text-[9px] capitalize">
              {preset.difficulty}
            </Badge>
          </div>
        </div>

        <div className="space-y-3 py-1">
          {/* Patient picker */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{tu('patient')}</Label>
            <Select value={patientId ?? ''} onValueChange={setPatientId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tu('selectPatient')} />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.affectedSide} side
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPatient && (
              <div className="flex items-center gap-2 rounded-md bg-muted/30 p-1.5">
                <GradientAvatar seed={selectedPatient.avatarSeed} name={selectedPatient.name} size="h-6 w-6" />
                <span className="text-[11px] text-muted-foreground">
                  {tu('patientSummary', { sessions: selectedPatient.sessionsCount, accuracy: selectedPatient.accuracy ?? 0 })}
                </span>
              </div>
            )}
          </div>

          {/* Target angle (pre-filled) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">{tu('targetAngle')}</Label>
              <span className="font-mono text-sm font-bold text-primary">{targetAngle}°</span>
            </div>
            <Slider
              value={[targetAngle]}
              min={30}
              max={180}
              step={5}
              onValueChange={(v) => setTargetAngle(v[0])}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground">
              {tu('prefilled', { angle: preset.targetAngle, limb: tu(`limb_${preset.limb}`) })}
            </p>
          </div>

          {/* Sessions per week */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">{tu('sessionsWeek')}</Label>
                <span className="font-mono text-xs font-bold">{sessionsPerWeek}</span>
              </div>
              <Slider
                value={[sessionsPerWeek]}
                min={1}
                max={14}
                step={1}
                onValueChange={(v) => setSessionsPerWeek(v[0])}
                className="py-1"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">{tu('dailyRepGoal')}</Label>
                <span className="font-mono text-xs font-bold">{dailyRepGoal}</span>
              </div>
              <Slider
                value={[dailyRepGoal]}
                min={5}
                max={100}
                step={5}
                onValueChange={(v) => setDailyRepGoal(v[0])}
                className="py-1"
              />
            </div>
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
            disabled={saving || !patientId}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {tu('prescribePlan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
