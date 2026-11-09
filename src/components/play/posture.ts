/**
 * Compensation check. After a stroke, patients often reach by leaning the trunk or hitching the
 * shoulder up instead of lifting the arm; therapists correct this because it trains the wrong
 * movement. The resting posture is taken while the patient sits still (the calibration); during a
 * task, a lean of the trunk or a raised shoulder on the reaching side that lasts more than a moment
 * counts once, for the doctor's report (compensationErrors), with a gentle spoken reminder at most
 * every so often. It never stops the task.
 *
 * Measured in the camera image, scaled by the patient's own shoulder width (about 38 cm for an
 * adult): sideways and downward shifts of the shoulders' midpoint, a forward lean from the shoulders
 * looking wider (nearer the camera), and the tilt of the shoulder line.
 */
import type { Side, TrackFrame } from './tracking'

export type Compensation = 'lean' | 'hike'

const SHOULDER_CM = 38
/** Usual distance from the camera when seated (cm), to turn "looks wider" into centimetres. */
const SEATED_DISTANCE_CM = 70
const LEAN_CM = 9
const HIKE_CM = 4.5
/** How long a posture must last to count (s), and how much it must ease before the next one counts. */
const HOLD_S = 0.6
const RELEASE_FRACTION = 0.6
const MIN_VISIBILITY = 0.6
const BASELINE_FRAMES = 30
/** While the posture is clearly relaxed, the baseline follows slow shifts in the seat. */
const DRIFT = 0.002

interface Shape { midX: number; midY: number; width: number; tilt: number }

function shapeOf(t: NonNullable<TrackFrame['trunk']>): Shape {
  const [lx, ly] = t.left, [rx, ry] = t.right
  // tilt > 0: the right shoulder sits higher than the left in the image (smaller y is higher).
  return { midX: (lx + rx) / 2, midY: (ly + ry) / 2, width: Math.hypot(rx - lx, ry - ly), tilt: ly - ry }
}

export class PostureWatch {
  private baseline: Shape | null = null
  private collecting: Shape[] = []
  private over: Record<Compensation, number> = { lean: 0, hike: 0 }
  private inEpisode: Record<Compensation, boolean> = { lean: false, hike: false }
  count = 0
  /** Latest measurements (cm), for the debug readout. */
  readonly last = { leanCm: 0, hikeCm: 0 }

  /** Collects the resting posture (call while the patient sits still). */
  observeRest(f: TrackFrame) {
    if (!f.trunk || f.trunk.visibility < MIN_VISIBILITY) return
    this.collecting.push(shapeOf(f.trunk))
    if (this.collecting.length >= BASELINE_FRAMES) this.fixBaseline()
  }

  private fixBaseline() {
    if (!this.collecting.length) return
    const med = (k: keyof Shape) => {
      const v = this.collecting.map((s) => s[k]).sort((a, b) => a - b)
      return v[Math.floor(v.length / 2)]
    }
    this.baseline = { midX: med('midX'), midY: med('midY'), width: med('width'), tilt: med('tilt') }
  }

  /**
   * One frame during a task. Returns the kind of compensation when one starts (once per episode),
   * else null. `side` is the reaching arm.
   */
  update(f: TrackFrame, side: Side, dt: number): Compensation | null {
    if (!f.trunk || f.trunk.visibility < MIN_VISIBILITY) return null
    if (!this.baseline) {
      // No calibration (skipped): take the first moments of play as the rest posture.
      this.observeRest(f)
      return null
    }
    const b = this.baseline, s = shapeOf(f.trunk)
    const cmPerUnit = SHOULDER_CM / b.width
    const sideways = Math.abs(s.midX - b.midX) * cmPerUnit
    const down = Math.max(0, s.midY - b.midY) * cmPerUnit
    const forward = Math.max(0, SEATED_DISTANCE_CM * (1 - b.width / s.width))
    const leanCm = Math.max(forward, Math.hypot(sideways, down))
    const raise = (s.tilt - b.tilt) * cmPerUnit
    const hikeCm = Math.max(0, side === 'right' ? raise : -raise)
    this.last.leanCm = leanCm
    this.last.hikeCm = hikeCm

    if (leanCm < LEAN_CM * 0.3 && hikeCm < HIKE_CM * 0.3) {
      for (const k of ['midX', 'midY', 'width', 'tilt'] as const) b[k] += (s[k] - b[k]) * DRIFT
    }
    // A lean also tilts the shoulders: report the lean, not both.
    return this.track('lean', leanCm, LEAN_CM, dt) ?? (leanCm < LEAN_CM ? this.track('hike', hikeCm, HIKE_CM, dt) : null)
  }

  private track(kind: Compensation, value: number, limit: number, dt: number): Compensation | null {
    if (this.inEpisode[kind]) {
      if (value < limit * RELEASE_FRACTION) this.inEpisode[kind] = false
      return null
    }
    this.over[kind] = value > limit ? this.over[kind] + dt : 0
    if (this.over[kind] < HOLD_S) return null
    this.inEpisode[kind] = true
    this.over[kind] = 0
    this.count++
    return kind
  }
}
