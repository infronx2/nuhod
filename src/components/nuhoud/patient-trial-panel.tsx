'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { ClipboardList, History, KeyRound, Loader2, Plus, QrCode as QrIcon, ScanFace, ShieldCheck, Trash2, UserX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { INSTRUMENTS, TIMEPOINTS, type Instrument } from '@/lib/measures'
import type { V2PatientDetail } from '@/lib/v2-types'
import { PatientCredentials, type IssuedCredentials } from '@/components/nuhoud/patient-credentials'

interface Measure { id: string; instrument: Instrument; value: number; side: string | null; timepoint: string; measuredAt: string; notes: string | null }
interface AuditEntry { id: string; action: string; createdAt: string; actor: { name: string; role: string } | null }

/** The trial side of a patient's file: how they sign in, the doctor's clinical measures, and the access log. */
export function PatientTrialPanel({ detail, onChanged }: { detail: V2PatientDetail; onChanged: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <AccessCard detail={detail} onChanged={onChanged} />
        <AuditCard patientId={detail.patient.id} />
      </div>
      <MeasuresCard patientId={detail.patient.id} className="lg:col-span-3" />
    </div>
  )
}

function AccessCard({ detail, onChanged }: { detail: V2PatientDetail; onChanged: () => void }) {
  const t = useTranslations('mvp')
  const locale = useLocale()
  const p = detail.patient
  const [issued, setIssued] = React.useState<IssuedCredentials | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const act = async (action: 'reset-pin' | 'qr' | 'remove-passkeys' | 'deactivate' | 'activate') => {
    if ((action === 'deactivate' || action === 'remove-passkeys') && !window.confirm(t(`confirm_${action}`))) return
    setBusy(action)
    try {
      const res = await apiFetch<{ pin?: string; qrToken?: string; qrExpiresAt?: string }>(`/api/v2/patients/${p.id}/credentials`, { method: 'POST', json: { action } })
      if (action === 'reset-pin' || action === 'qr') setIssued({ name: p.name, username: p.username ?? '', pin: res.pin, qrToken: res.qrToken, qrExpiresAt: res.qrExpiresAt })
      else { toast.success(t('saved')); onChanged() }
    } catch { toast.error(t('actionFailed')) } finally { setBusy(null) }
  }

  const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

  return (
    <Card className="flex flex-col gap-3 border-border/40 bg-card/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('accessTitle')}</h3>
        {p.active === false && <Badge variant="outline" className="border-rose-500/40 text-rose-600">{t('inactive')}</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t('username')}</dt><dd dir="ltr" className="text-start font-mono font-semibold">{p.username ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('faceTitle')}</dt><dd className="flex items-center gap-1"><ScanFace className="h-3.5 w-3.5" /> {p.passkeys ? t('devices', { n: p.passkeys }) : t('notSet')}</dd>
        <dt className="text-muted-foreground">{t('writtenConsent')}</dt><dd className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> {date(p.consentSignedAt)}</dd>
        <dt className="text-muted-foreground">{t('appConsent')}</dt><dd>{p.patientConsentAt ? date(p.patientConsentAt) : t('notYet')}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void act('qr')}>
          {busy === 'qr' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrIcon className="h-3.5 w-3.5" />} {t('newQr')}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void act('reset-pin')}>
          {busy === 'reset-pin' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} {t('resetPin')}
        </Button>
        {!!p.passkeys && (
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={!!busy} onClick={() => void act('remove-passkeys')}>
            <ScanFace className="h-3.5 w-3.5" /> {t('removeFace')}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={!!busy} onClick={() => void act(p.active === false ? 'activate' : 'deactivate')}>
          <UserX className="h-3.5 w-3.5" /> {p.active === false ? t('activate') : t('deactivate')}
        </Button>
      </div>
      <Dialog open={!!issued} onOpenChange={(v) => !v && setIssued(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('accessTitle')}</DialogTitle></DialogHeader>
          {issued && <PatientCredentials creds={issued} />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function MeasuresCard({ patientId, className }: { patientId: string; className?: string }) {
  const t = useTranslations('mvp')
  const locale = useLocale()
  const [rows, setRows] = React.useState<Measure[] | null>(null)
  const [instrument, setInstrument] = React.useState<Instrument>('fma_ue')
  const [value, setValue] = React.useState('')
  const [side, setSide] = React.useState<'right' | 'left'>('right')
  const [timepoint, setTimepoint] = React.useState<(typeof TIMEPOINTS)[number]>('baseline')
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(() =>
    apiFetch<{ measures: Measure[] }>(`/api/v2/patients/${patientId}/measures`).then((d) => setRows(d.measures)).catch(() => setRows([])), [patientId])
  React.useEffect(() => { void load() }, [load])

  const spec = INSTRUMENTS[instrument]
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = Number(value)
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) { toast.error(t('rangeError', { min: spec.min, max: spec.max })); return }
    setBusy(true)
    try {
      await apiFetch(`/api/v2/patients/${patientId}/measures`, { method: 'POST', json: { instrument, value: v, side: spec.sided ? side : undefined, timepoint, measuredAt: date } })
      setValue('')
      await load()
    } catch { toast.error(t('actionFailed')) } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    if (!window.confirm(t('confirm_measure'))) return
    await apiFetch(`/api/v2/patients/${patientId}/measures?measureId=${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <Card className={cn('flex flex-col gap-3 border-border/40 bg-card/60 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('measuresTitle')}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{t('measuresHint')}</p>
      <form onSubmit={add} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-2">
          <Label className="text-xs">{t('instrument')}</Label>
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as Instrument)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {(Object.keys(INSTRUMENTS) as Instrument[]).map((k) => <option key={k} value={k}>{t(`inst_${k}`)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('value')} ({spec.min}–{spec.max})</Label>
          <Input dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="h-9" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('side')}</Label>
          <select disabled={!spec.sided} value={side} onChange={(e) => setSide(e.target.value as 'right' | 'left')} className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-40">
            <option value="right">{t('side_right')}</option><option value="left">{t('side_left')}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('timepoint')}</Label>
          <select value={timepoint} onChange={(e) => setTimepoint(e.target.value as (typeof TIMEPOINTS)[number])} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {TIMEPOINTS.map((k) => <option key={k} value={k}>{t(`tp_${k}`)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('date')}</Label>
          <Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
        </div>
        <Button type="submit" size="sm" disabled={busy} className="col-span-2 h-9 gap-1.5 sm:col-span-6 sm:justify-self-start">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t('addMeasure')}
        </Button>
      </form>
      {rows === null ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noMeasures')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="py-1 text-start font-medium">{t('date')}</th><th className="text-start font-medium">{t('instrument')}</th><th className="text-start font-medium">{t('value')}</th><th className="text-start font-medium">{t('timepoint')}</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-border/40">
                  <td className="py-1.5 tabular-nums">{new Date(m.measuredAt).toLocaleDateString(locale === 'ar' ? 'ar-OM' : 'en-GB')}</td>
                  <td>{t(`inst_${m.instrument}`)}{m.side ? ` · ${t(`side_${m.side}`)}` : ''}</td>
                  <td className="font-mono font-semibold tabular-nums">{m.value}</td>
                  <td>{t(`tp_${m.timepoint}`)}</td>
                  <td className="text-end"><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" aria-label={t('remove')} onClick={() => void remove(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function AuditCard({ patientId }: { patientId: string }) {
  const t = useTranslations('mvp')
  const locale = useLocale()
  const [rows, setRows] = React.useState<AuditEntry[] | null>(null)
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    if (!open || rows) return
    apiFetch<{ entries: AuditEntry[] }>(`/api/v2/patients/${patientId}/audit`).then((d) => setRows(d.entries)).catch(() => setRows([]))
  }, [open, rows, patientId])

  return (
    <Card className="flex flex-col gap-2 border-border/40 bg-card/60 p-4 sm:p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-start">
        <History className="h-4 w-4 text-primary" />
        <h3 className="flex-1 text-sm font-semibold">{t('auditTitle')}</h3>
        <span className="text-xs text-primary">{open ? t('hide') : t('show')}</span>
      </button>
      {open && (rows === null ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-2 border-b border-border/30 py-1">
              <span>{t(`audit_${r.action}`)}{r.actor ? ` · ${r.actor.name}` : ''}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{new Date(r.createdAt).toLocaleString(locale === 'ar' ? 'ar-OM' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      ))}
    </Card>
  )
}
