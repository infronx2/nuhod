'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type {
  ServerMessage,
  TrackingMessage,
  ErrorMessage,
  ConfigAckMessage,
  WsConnectionState,
  WsCommand,
  PoseLandmarks,
} from '@/components/nuhoud/types'

const WS_PATH = '/ws/track'

export interface PoseTrackingConfig {
  limb: 'right' | 'left'
  target_angle: number
  compensation_threshold: number
  /**
   * The authenticated patient's id. When set, the WS URL includes it as a
   * query param so the Python pose-server can auto-sync the completed
   * session to the Next.js DB on WS close (no manual Save needed).
   */
  patient_id?: string
}

export interface PoseTrackingState {
  connection: WsConnectionState
  tracking: TrackingMessage | null
  command: WsCommand
  elbowAngle: number | null
  targetAngle: number
  targetReached: boolean
  compensationDetected: boolean
  repCount: number
  score: number
  maxAchievedAngle: number
  compensationErrors: number
  visibility: number
  landmarks: PoseLandmarks | null
  latencyMs: number
  fpsAvg: number
  lastError: ErrorMessage | null
  lastConfigAck: ConfigAckMessage | null
  /**
   * Time series buffers (last N samples) for sparklines.
   */
  latencyHistory: number[]
  angleHistory: number[]
  fpsHistory: number[]
  /**
   * Raw server message log (last ~200 entries) for the JSON stream panel.
   * This is the up-to-date source of truth that the UI consumes.
   */
  messageLog: ServerMessage[]
}

export interface PoseTrackingApi extends PoseTrackingState {
  start: () => void
  stop: () => void
  sendFrame: (base64Jpeg: string) => void
  sendConfig: (cfg: Partial<PoseTrackingConfig>) => void
  clearLog: () => void
}

const HISTORY_LIMIT = 30
const MESSAGE_LOG_LIMIT = 200

/**
 * usePoseTracking — encapsulates the entire WebSocket lifecycle against the
 * Nuhoud Python inference backend (mini-services/pose-server on :8001).
 *
 * Connection URL: ws://${window.location.host}/ws/track?XTransformPort=8001
 * (the Caddy gateway rewrites ?XTransformPort=8001 to localhost:8001)
 *
 * The hook is intentionally framework-agnostic: callers feed it frames via
 * `sendFrame` and consume state via the returned object. It owns no canvas,
 * no getUserMedia, no MediaPipe — just the wire protocol and the derived
 * client-facing state.
 */
export function usePoseTracking(initial: PoseTrackingConfig): PoseTrackingApi {
  const [connection, setConnection] = React.useState<WsConnectionState>('Disconnected')
  const [tracking, setTracking] = React.useState<TrackingMessage | null>(null)
  const [lastError, setLastError] = React.useState<ErrorMessage | null>(null)
  const [lastConfigAck, setLastConfigAck] = React.useState<ConfigAckMessage | null>(null)
  const [messageLog, setMessageLog] = React.useState<ServerMessage[]>([])
  const [latencyHistory, setLatencyHistory] = React.useState<number[]>([])
  const [angleHistory, setAngleHistory] = React.useState<number[]>([])
  const [fpsHistory, setFpsHistory] = React.useState<number[]>([])
  const [appliedConfig, setAppliedConfig] = React.useState<PoseTrackingConfig>(initial)

  const wsRef = React.useRef<WebSocket | null>(null)
  const configRef = React.useRef<PoseTrackingConfig>(initial)
  const manualCloseRef = React.useRef(false)

  // Keep config ref fresh so sendConfig can always read latest values.
  React.useEffect(() => {
    configRef.current = {
      limb: initial.limb,
      target_angle: initial.target_angle,
      compensation_threshold: initial.compensation_threshold,
    }
    setAppliedConfig((prev) =>
      prev.limb === initial.limb &&
      prev.target_angle === initial.target_angle &&
      prev.compensation_threshold === initial.compensation_threshold
        ? prev
        : { ...prev, limb: initial.limb, target_angle: initial.target_angle, compensation_threshold: initial.compensation_threshold },
    )
  }, [initial.limb, initial.target_angle, initial.compensation_threshold])

  const appendMessage = React.useCallback((msg: ServerMessage) => {
    setMessageLog((prev) => {
      const next = [...prev, msg]
      if (next.length > MESSAGE_LOG_LIMIT) next.splice(0, next.length - MESSAGE_LOG_LIMIT)
      return next
    })
  }, [])

  const start = React.useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return
    if (typeof window === 'undefined') return

    const host = window.location.host
    const cfg = configRef.current
    const patientParam = cfg.patient_id ? `&patient_id=${encodeURIComponent(cfg.patient_id)}` : ''
    const url = `ws://${host}${WS_PATH}?XTransformPort=8001&limb=${encodeURIComponent(
      cfg.limb,
    )}&target_angle=${cfg.target_angle}&compensation_threshold=${cfg.compensation_threshold}${patientParam}`

    manualCloseRef.current = false
    setConnection('Connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      console.error('WebSocket construction failed', err)
      setConnection('Disconnected')
      toast.error('Could not open WebSocket', {
        description: err instanceof Error ? err.message : 'unknown error',
      })
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      setConnection('Connected')
      toast.success('Connected to Nuhoud inference server', {
        description: 'WebSocket live · ready for frames',
      })
    }

    ws.onmessage = (event) => {
      let parsed: ServerMessage
      try {
        parsed = JSON.parse(event.data) as ServerMessage
      } catch (err) {
        console.warn('Bad JSON from server', err)
        return
      }
      appendMessage(parsed)
      if (parsed.type === 'tracking') {
        setTracking(parsed)
        if (typeof parsed.latency_ms === 'number') {
          setLatencyHistory((h) => {
            const n = [...h, parsed.latency_ms]
            if (n.length > HISTORY_LIMIT) n.shift()
            return n
          })
        }
        if (typeof parsed.elbow_angle === 'number') {
          setAngleHistory((h) => {
            const n = [...h, parsed.elbow_angle as number]
            if (n.length > HISTORY_LIMIT) n.shift()
            return n
          })
        }
        if (typeof parsed.fps_avg === 'number') {
          setFpsHistory((h) => {
            const n = [...h, parsed.fps_avg]
            if (n.length > HISTORY_LIMIT) n.shift()
            return n
          })
        }
      } else if (parsed.type === 'error') {
        setLastError(parsed)
      } else if (parsed.type === 'config_ack') {
        setLastConfigAck(parsed)
        setAppliedConfig({
          limb: parsed.limb,
          target_angle: parsed.target_angle,
          compensation_threshold: parsed.compensation_threshold,
        })
      }
    }

    ws.onerror = (event) => {
      console.error('WebSocket error', event)
    }

    ws.onclose = () => {
      setConnection('Disconnected')
      wsRef.current = null
      if (!manualCloseRef.current) {
        toast.error('WebSocket closed', {
          description: 'The inference server connection dropped.',
        })
      }
    }
  }, [appendMessage])

  const stop = React.useCallback(() => {
    manualCloseRef.current = true
    const ws = wsRef.current
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close(1000, 'client_stop')
      } catch {
        /* ignore */
      }
    }
    wsRef.current = null
    setConnection('Disconnected')
    setTracking(null)
  }, [])

  const sendFrame = React.useCallback((base64Jpeg: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // Allow either raw base64 or a data URI; backend strips the prefix.
    const image = base64Jpeg.startsWith('data:image/jpeg;base64,')
      ? base64Jpeg
      : `data:image/jpeg;base64,${base64Jpeg}`
    try {
      ws.send(JSON.stringify({ type: 'frame', image }))
    } catch (err) {
      console.error('sendFrame failed', err)
    }
  }, [])

  const sendConfig = React.useCallback((cfg: Partial<PoseTrackingConfig>) => {
    const ws = wsRef.current
    const next: PoseTrackingConfig = {
      ...configRef.current,
      ...cfg,
    }
    configRef.current = next
    setAppliedConfig(next)
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(
        JSON.stringify({
          type: 'config',
          target_angle: next.target_angle,
          limb: next.limb,
          compensation_threshold: next.compensation_threshold,
        }),
      )
    } catch (err) {
      console.error('sendConfig failed', err)
    }
  }, [])

  const clearLog = React.useCallback(() => {
    setMessageLog([])
    setLastError(null)
  }, [])

  // Cleanup on unmount.
  React.useEffect(() => {
    return () => {
      manualCloseRef.current = true
      const ws = wsRef.current
      if (ws && ws.readyState <= WebSocket.OPEN) {
        try {
          ws.close(1000, 'unmount')
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const trackingMsg = tracking
  const command: WsCommand = trackingMsg?.command ?? 'NO_POSE'

  return {
    connection,
    tracking: trackingMsg,
    command,
    elbowAngle: trackingMsg?.elbow_angle ?? null,
    targetAngle: trackingMsg?.target_angle ?? appliedConfig.target_angle,
    targetReached: trackingMsg?.target_reached ?? false,
    compensationDetected: trackingMsg?.compensation_detected ?? false,
    repCount: trackingMsg?.rep_count ?? 0,
    score: trackingMsg?.score ?? 0,
    maxAchievedAngle: trackingMsg?.max_achieved_angle ?? 0,
    compensationErrors: trackingMsg?.compensation_errors ?? 0,
    visibility: trackingMsg?.visibility ?? 0,
    landmarks: trackingMsg?.landmarks ?? null,
    latencyMs: trackingMsg?.latency_ms ?? 0,
    fpsAvg: trackingMsg?.fps_avg ?? 0,
    lastError,
    lastConfigAck,
    latencyHistory,
    angleHistory,
    fpsHistory,
    messageLog,
    start,
    stop,
    sendFrame,
    sendConfig,
    clearLog,
  }
}
