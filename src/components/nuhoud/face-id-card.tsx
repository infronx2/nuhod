'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Loader2, ScanFace, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import { addPasskey, usePasskeysSupported } from '@/lib/passkey-client'

interface PasskeyRow { id: string; deviceLabel: string | null; createdAt: string; lastUsedAt: string | null }

/** Turn Face ID / fingerprint sign-in on for this phone, or remove it (lost or shared phone). */
export function FaceIdCard() {
  const t = useTranslations('mvp')
  const [rows, setRows] = React.useState<PasskeyRow[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const supported = usePasskeysSupported()

  const load = React.useCallback(() =>
    apiFetch<{ passkeys: PasskeyRow[] }>('/api/v2/auth/passkeys').then((d) => setRows(d.passkeys)).catch(() => setRows([])), [])
  React.useEffect(() => { void load() }, [load])

  if (!supported && !rows?.length) return null

  const add = async () => {
    setBusy(true)
    try {
      await addPasskey()
      toast.success(t('faceAdded'))
      await load()
    } catch (err) {
      if (!(err instanceof Error && err.name === 'NotAllowedError')) toast.error(t('faceFailed'))
    } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    await apiFetch(`/api/v2/auth/passkeys?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <Card className="flex flex-col gap-3 border-border/40 bg-card/70 p-5">
      <div className="flex items-center gap-2">
        <ScanFace className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">{t('faceTitle')}</h2>
      </div>
      {rows?.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {t('faceOn', { device: r.deviceLabel ?? '' })}</span>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={() => void remove(r.id)}>
                <Trash2 className="h-3.5 w-3.5" /> {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('faceExplain')}</p>
      )}
      {supported && (
        <Button variant={rows?.length ? 'outline' : 'default'} onClick={() => void add()} disabled={busy} className="h-11 gap-2 self-start">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
          {rows?.length ? t('faceAddAnother') : t('faceEnable')}
        </Button>
      )}
    </Card>
  )
}
