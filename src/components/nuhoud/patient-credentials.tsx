'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QrCode, qrSignInUrl } from '@/components/nuhoud/qr-code'

export interface IssuedCredentials {
  name: string
  username: string
  pin?: string
  qrToken?: string
  qrExpiresAt?: string
}

/**
 * What the doctor hands the patient: username, the PIN (shown only now), and a one-time QR code
 * for the patient's phone. Printing gives a card the patient can keep (the QR works once, 24 hours).
 */
export function PatientCredentials({ creds }: { creds: IssuedCredentials }) {
  const t = useTranslations('mvp')
  const url = creds.qrToken ? qrSignInUrl(creds.qrToken) : null
  const ref = React.useRef<HTMLDivElement>(null)

  const print = () => {
    const w = window.open('', '_blank', 'width=480,height=640')
    if (!w || !ref.current) return
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>Nuhoud</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#0B3E46}h1{font-size:20px}.row{margin:10px 0;font-size:16px}
      code{font-size:22px;letter-spacing:.15em;direction:ltr;display:inline-block}svg{width:220px;height:220px}</style></head>
      <body>${ref.current.innerHTML}</body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="flex flex-col gap-4">
      <div ref={ref} className="flex flex-col items-center gap-3 rounded-2xl border border-border/50 bg-card p-5 text-center">
        <h1 className="text-lg font-semibold">{t('cardTitle', { name: creds.name })}</h1>
        <div className="row text-sm">{t('username')}: <code dir="ltr" className="font-mono text-lg font-semibold tracking-wider">{creds.username}</code></div>
        {creds.pin && <div className="row text-sm">{t('pin')}: <code dir="ltr" className="font-mono text-2xl font-bold tracking-[0.3em]">{creds.pin}</code></div>}
        {url && (
          <>
            <QrCode value={url} className="h-48 w-48" />
            <p className="max-w-xs text-xs text-muted-foreground">{t('qrHint')}</p>
          </>
        )}
      </div>
      {creds.pin && <p className="text-xs text-amber-600 dark:text-amber-400">{t('pinOnce')}</p>}
      <Button variant="outline" onClick={print} className="gap-2 self-start"><Printer className="h-4 w-4" /> {t('print')}</Button>
    </div>
  )
}
