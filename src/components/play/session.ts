/**
 * The session record (UNuhoudGameInstance's metrics) and its upload: the same fields the Unreal game
 * sends to POST /api/v2/sessions, with source "web". A session that cannot be sent is kept in
 * localStorage and sent on the next visit; clientSessionId makes a re-send return the stored row.
 */
import { apiFetch } from '@/lib/api'

const PENDING_KEY = 'nuhoud_pending_sessions'
const NO_PINCH = 99

export class SessionRecord {
  readonly clientSessionId = crypto.randomUUID()
  readonly startedAt = new Date()
  private start = performance.now()
  attempts = 0
  reps = 0
  assisted = 0
  score = 0
  maxAngle = 0
  private avgAngle = 0
  private samples = 0
  maxElbow = 0
  maxGrip = 0
  minPinch = NO_PINCH
  graspCount = 0
  pinchCount = 0
  rightGrabs = 0
  leftGrabs = 0
  painStop = false
  private timeline: number[] = []
  private interval = 1
  private lastSample = 0
  private peak = 0

  get seconds() { return (performance.now() - this.start) / 1000 }

  recordTask(points: number, assisted: boolean) {
    this.score += points
    this.reps++
    this.attempts++
    if (assisted) this.assisted++
  }

  recordFailed() { this.attempts++ }

  recordGrab(pinch: boolean, right: boolean) {
    if (pinch) this.pinchCount++
    else this.graspCount++
    if (right) this.rightGrabs++
    else this.leftGrabs++
  }

  recordGrip(closure: number, pinchCm: number) {
    this.maxGrip = Math.max(this.maxGrip, closure)
    if (pinchCm > 0) this.minPinch = Math.min(this.minPinch, pinchCm)
  }

  /** Shoulder elevation of the reaching arm; the timeline keeps each interval's peak. */
  recordAngle(angle: number, elbow: number) {
    this.maxAngle = Math.max(this.maxAngle, angle)
    this.maxElbow = Math.max(this.maxElbow, elbow)
    this.samples++
    this.avgAngle += (angle - this.avgAngle) / this.samples
    this.peak = Math.max(this.peak, angle)
    const now = this.seconds
    if (now - this.lastSample >= this.interval) {
      this.lastSample = now
      this.timeline.push(Math.round(this.peak * 10) / 10)
      this.peak = 0
      if (this.timeline.length >= 600) {
        // Long session: halve the resolution so the whole session still fits.
        const half: number[] = []
        for (let i = 0; i + 1 < this.timeline.length; i += 2) half.push(Math.max(this.timeline[i], this.timeline[i + 1]))
        this.timeline = half
        this.interval *= 2
      }
    }
  }

  worthSaving() { return this.attempts > 0 || this.seconds >= 60 || this.painStop }

  payload(patientId: string) {
    const r1 = (v: number) => Math.round(v * 10) / 10
    return {
      patientId,
      clientSessionId: this.clientSessionId,
      sessionDate: this.startedAt.toISOString(),
      source: 'web',
      ...(this.rightGrabs || this.leftGrabs
        ? { limb: this.rightGrabs && this.leftGrabs ? 'bilateral' : this.rightGrabs ? 'right' : 'left' }
        : {}),
      durationSeconds: Math.round(this.seconds),
      totalReps: this.attempts,
      correctReps: Math.max(0, this.reps - this.assisted),
      compensationErrors: 0,
      gamificationScore: this.score,
      maxAchievedAngle: r1(this.maxAngle),
      avgShoulderAngle: r1(this.avgAngle),
      maxElbowROM: r1(this.maxElbow),
      gripClosureMax: r1(this.maxGrip * 100),
      pinchMinCm: this.minPinch < NO_PINCH ? r1(this.minPinch) : 0,
      graspCount: this.graspCount,
      pinchCount: this.pinchCount,
      tasksAssisted: this.assisted,
      painStop: this.painStop,
      angleTimeline: this.timeline,
    }
  }
}

type Payload = ReturnType<SessionRecord['payload']>

function pending(): Payload[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') } catch { return [] }
}
function setPending(list: Payload[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
}

/** Saves locally first, then sends; true when the server stored it. */
export async function saveSession(p: Payload): Promise<boolean> {
  setPending([...pending().filter((x) => x.clientSessionId !== p.clientSessionId), p])
  return flushPending(p.patientId)
}

/** Sends this patient's sessions waiting in the browser; returns whether none is left. */
export async function flushPending(patientId: string): Promise<boolean> {
  let list = pending()
  for (const p of list.filter((x) => x.patientId === patientId)) {
    try {
      await apiFetch('/api/v2/sessions', { method: 'POST', body: JSON.stringify(p) })
      list = list.filter((x) => x.clientSessionId !== p.clientSessionId)
      setPending(list)
    } catch {
      return false
    }
  }
  return true
}
