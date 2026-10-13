'use client'

import * as React from 'react'
import { Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ServerMessage, WsCommand, WsErrorCode } from '@/components/nuhoud/types'

interface JsonStreamProps {
  messages: ServerMessage[]
  onClear: () => void
}

const COMMAND_COLORS: Record<WsCommand, string> = {
  KEEP_GOING: 'text-primary',
  HOLD: 'text-amber-400',
  TARGET_HIT: 'text-emerald-400',
  CORRECT_POSTURE: 'text-rose-400',
  NO_POSE: 'text-slate-400',
}

const ERROR_COLORS: Record<WsErrorCode, string> = {
  BAD_FRAME: 'text-rose-400',
  BAD_JSON: 'text-rose-400',
  BAD_TYPE: 'text-rose-400',
  INFER_FAIL: 'text-amber-400',
  SERVER: 'text-rose-500',
  NO_POSE: 'text-slate-400',
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' +
    String(d.getMilliseconds()).padStart(3, '0')
}

/**
 * Render a single server message as a compact, color-coded monospace line.
 */
function MessageLine({ msg }: { msg: ServerMessage }) {
  const ts = msg.type === 'tracking' || msg.type === 'error'
    ? (msg as { timestamp?: number }).timestamp
    : undefined
  const timeStr = ts ? formatTime(ts) : formatTime(Date.now() / 1000)

  if (msg.type === 'tracking') {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-muted/30">
        <span className="shrink-0 text-slate-500">{timeStr}</span>
        <span className="shrink-0 font-bold text-sky-400">TRACK</span>
        <span
          className={cn(
            'shrink-0 font-bold',
            COMMAND_COLORS[msg.command] ?? 'text-slate-400',
          )}
        >
          {msg.command}
        </span>
        <span className="text-slate-300">
          angle={msg.elbow_angle ?? 'null'}° reps={msg.rep_count} score={msg.score}
          max={msg.max_achieved_angle?.toFixed(1) ?? '0'}° comp={msg.compensation_errors}
          vis={msg.visibility?.toFixed(2) ?? '0'} lat={msg.latency_ms?.toFixed(0) ?? '0'}ms
          fps={msg.fps_avg?.toFixed(0) ?? '0'}
        </span>
      </div>
    )
  }
  if (msg.type === 'error') {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-muted/30">
        <span className="shrink-0 text-slate-500">{timeStr}</span>
        <span className="shrink-0 font-bold text-rose-500">ERROR</span>
        <span className={cn('shrink-0 font-bold', ERROR_COLORS[msg.code])}>
          {msg.code}
        </span>
        <span className="text-slate-300">{msg.message}</span>
      </div>
    )
  }
  // config_ack
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-muted/30">
      <span className="shrink-0 text-slate-500">{timeStr}</span>
      <span className="shrink-0 font-bold text-emerald-400">CFG_ACK</span>
      <span className="text-slate-300">
        limb={msg.limb} target={msg.target_angle}° thr={msg.compensation_threshold}
      </span>
    </div>
  )
}

export function JsonStream({ messages, onClear }: JsonStreamProps) {
  const [paused, setPaused] = React.useState(false)
  const [autoScroll, setAutoScroll] = React.useState(true)
  // Snapshot taken when entering pause so the visible log doesn't move
  // while the user inspects it. Held in state to satisfy the rule that
  // refs must not be read during render.
  const [pausedSnapshot, setPausedSnapshot] = React.useState<ServerMessage[] | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  // Toggle pause: capture the current message list on enter, clear on exit.
  const togglePause = React.useCallback(() => {
    setPaused((wasPaused) => {
      const nowPaused = !wasPaused
      if (nowPaused) setPausedSnapshot(messages)
      else setPausedSnapshot(null)
      return nowPaused
    })
  }, [messages])

  const visibleMessages = paused && pausedSnapshot ? pausedSnapshot : messages

  React.useEffect(() => {
    if (!autoScroll || paused) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, autoScroll, paused])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16
    setAutoScroll(atBottom)
  }

  return (
    <section
      aria-label="Live JSON stream"
      className="rounded-xl border border-border/60 bg-card/40 p-4 sm:p-6"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Live JSON Stream
          </h2>
          <p className="text-sm text-muted-foreground">
            Raw server messages over the WebSocket. Auto-scrolls unless you scroll up.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={togglePause}
            aria-pressed={paused}
            aria-label={paused ? 'Resume stream' : 'Pause stream'}
          >
            {paused ? (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                Pause
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={onClear}
            aria-label="Clear stream"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="nm-scroll-thin max-h-96 overflow-y-auto rounded-md border border-border/60 bg-slate-950/80 font-mono text-xs leading-relaxed text-slate-200"
        role="log"
        aria-live="off"
        aria-label="Server message log"
      >
        {visibleMessages.length === 0 ? (
          <div className="px-3 py-6 text-center text-muted-foreground">
            No messages yet — start tracking to see the server response stream.
          </div>
        ) : (
          visibleMessages.map((m, idx) => (
            <MessageLine
              key={idx + ((m as { timestamp?: number })?.timestamp ?? idx)}
              msg={m}
            />
          ))
        )}
      </div>

      {!autoScroll && !paused && (
        <div className="mt-2 text-center text-xs text-amber-500">
          Auto-scroll paused · scroll to bottom to resume
        </div>
      )}
    </section>
  )
}
