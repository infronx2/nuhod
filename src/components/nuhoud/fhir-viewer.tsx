'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, Copy, FileJson, Loader2, Activity } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SessionReplay } from '@/components/nuhoud/session-replay'
import type { V2FhirResponse } from '@/lib/v2-types'

interface FhirViewerProps {
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SessionDetail {
  id: string
  angleTimeline: string | null
  maxAchievedAngle: number
  durationSeconds: number
  limb: string
  sessionDate: string
}

/**
 * FhirViewer — Dialog that fetches /api/v2/sessions/[id]/fhir and shows the
 * FHIR R4 Observation JSON, OR fetches /api/v2/sessions/[id] and shows the
 * session-replay timeline. Two tabs: "FHIR" and "Replay".
 *
 * The viewer renders client-side only after open, so it never blocks SSR.
 */
export function FhirViewer({ sessionId, open, onOpenChange }: FhirViewerProps) {
  const [json, setJson] = React.useState<string>('')
  const [loading, setLoading] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [tab, setTab] = React.useState<'fhir' | 'replay'>('fhir')
  const [sessionDetail, setSessionDetail] = React.useState<SessionDetail | null>(null)
  const [sessionLoading, setSessionLoading] = React.useState(false)

  // Fetch FHIR JSON.
  React.useEffect(() => {
    if (!open || !sessionId) return
    let cancelled = false
    setLoading(true)
    setJson('')
    apiFetch<V2FhirResponse>(`/api/v2/sessions/${sessionId}/fhir`)
      .then((data) => {
        if (cancelled) return
        setJson(JSON.stringify(data.fhir, null, 2))
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load FHIR'
        toast.error('FHIR load failed', { description: msg })
        setJson(`{\n  "error": "${msg}"\n}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionId])

  // Fetch session detail (for replay) — lazy, only when the Replay tab opens.
  React.useEffect(() => {
    if (!open || !sessionId || tab !== 'replay' || sessionDetail) return
    let cancelled = false
    setSessionLoading(true)
    apiFetch<{ ok: boolean; session: SessionDetail }>(`/api/v2/sessions/${sessionId}`)
      .then((data) => {
        if (cancelled) return
        setSessionDetail(data.session)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load session'
        toast.error('Session load failed', { description: msg })
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionId, tab, sessionDetail])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success('FHIR JSON copied')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const handleDownload = () => {
    if (!sessionId) return
    const blob = new Blob([json], { type: 'application/fhir+json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fhir-observation-${sessionId}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('FHIR JSON downloaded')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-primary" />
            Session detail
          </DialogTitle>
          <DialogDescription>
            Session{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
              {sessionId}
            </code>
            — view the HL7 FHIR R4 Observation or replay the angle timeline.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-border/40 bg-muted/30 p-1">
          <button
            onClick={() => setTab('fhir')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === 'fhir'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileJson className="h-3.5 w-3.5" />
            FHIR R4
          </button>
          <button
            onClick={() => setTab('replay')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === 'replay'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            Replay
          </button>
        </div>

        {/* Tab content */}
        {tab === 'fhir' ? (
          <div className="nm-scroll-thin max-h-[55vh] overflow-auto rounded-md border border-border/40 bg-slate-950 p-3">
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-full" style={{ width: `${60 + ((i * 13) % 40)}%` }} />
                ))}
                <div className="mt-2 flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading FHIR payload…
                </div>
              </div>
            ) : (
              <pre className="text-[11px] leading-relaxed">
                <code dangerouslySetInnerHTML={{ __html: highlightFhir(json) }} />
              </pre>
            )}
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-md border border-border/40 bg-card/40 p-3">
            {sessionLoading ? (
              <div className="flex flex-col gap-3 py-8">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : sessionDetail ? (
              <SessionReplay
                angleTimelineJson={sessionDetail.angleTimeline}
                maxAngle={sessionDetail.maxAchievedAngle}
                durationSeconds={sessionDetail.durationSeconds}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Could not load session data.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {tab === 'fhir' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={loading || !json}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied!' : 'Copy JSON'}
              </Button>
              <Button
                size="sm"
                onClick={handleDownload}
                disabled={loading || !json}
                className="gap-1.5 bg-primary text-white hover:bg-primary"
              >
                <Download className="h-3.5 w-3.5" />
                Download .json
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Tiny JSON syntax highlighter — returns an HTML string with spans colored
 * by token type. This is a focused highlighter for FHIR JSON only (no
 * arbitrary code) so the regex surface area is small.
 *
 * IMPORTANT: the input is always the output of `JSON.stringify(..., null, 2)`
 * from our own server, so we know it's safe (no script injection vector).
 */
function highlightFhir(json: string): string {
  if (!json) return ''
  // Escape HTML first.
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(
    // tokens: strings ("key": | "value"), numbers, booleans, null
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'text-amber-300'
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'text-primary' : 'text-emerald-300'
      } else if (/true|false/.test(match)) {
        cls = 'text-rose-400'
      } else if (/null/.test(match)) {
        cls = 'text-slate-500'
      } else if (/-?\d/.test(match)) {
        cls = 'text-sky-300'
      }
      return `<span class="${cls}">${match}</span>`
    },
  )
}
