/**
 * Per-hand calibration at the start of a session: the patient opens each hand the plan trains as
 * wide as they can, closes it as far as they can, then brings thumb and index together. The game
 * learns that hand's own range, so the grip and pinch thresholds fit what this patient can do today
 * (after a stroke a hand often cannot open or close fully), and the trunk's resting posture is
 * taken while they sit still, for the compensation check.
 *
 * Each step runs on a timer that pauses while the hand is out of view; a step that learned nothing
 * (the hand barely changed) leaves the usual adaptive thresholds in place.
 */
import type { Side } from './tracking'

export interface HandRange {
  /** Hand closure (0 open … 1 closed fist) with the hand opened as far as the patient can. */
  open: number
  /** Closure with the hand closed as far as the patient can. */
  fist: number
  /** Smallest thumb–index distance reached (cm). */
  pinchCm: number
}

type StepKind = 'open' | 'fist' | 'pinch'
interface Step { side: Side; kind: StepKind }

/** Seconds per step, of which the first part is ignored while the hand changes shape. */
const STEP_S = 3.5
const SETTLE_S = 1
/** A step gives up after this long without seeing the hand (s). */
const STEP_TIMEOUT_S = 10
/** Smallest open-to-fist difference that counts as a real measurement. */
const MIN_RANGE = 0.12

const SIDE_AR: Record<Side, string> = { right: 'اليمنى', left: 'اليسرى' }

export interface CalibrationInput {
  visible(side: Side): boolean
  closure(side: Side): number
  pinchCm(side: Side): number
}

export class Calibration {
  private steps: Step[]
  private index = 0
  private time = 0
  private waited = 0
  private samples: number[] = []
  private raw: Partial<Record<Side, Partial<Record<StepKind, number>>>> = {}
  readonly results: Partial<Record<Side, HandRange>> = {}
  /** Called when a step starts, with its instruction (for the voice). */
  onStep: ((text: string) => void) | null = null

  constructor(sides: Side[]) {
    this.steps = sides.flatMap((side) => (['open', 'fist', 'pinch'] as StepKind[]).map((kind) => ({ side, kind })))
  }

  get done() { return this.index >= this.steps.length }

  /** The on-screen instruction, with the seconds left. */
  instruction(input: CalibrationInput): string {
    const step = this.steps[this.index]
    if (!step) return ''
    if (!input.visible(step.side)) return `ارفع يدك ${SIDE_AR[step.side]} قدام الكاميرا`
    const left = Math.max(1, Math.ceil(STEP_S - this.time))
    return `${this.text(step)} · ${left}`
  }

  private text(step: Step) {
    const hand = `يدك ${SIDE_AR[step.side]}`
    if (step.kind === 'open') return `افتح ${hand} على الآخر وثبّتها`
    if (step.kind === 'fist') return `سكّر ${hand} قبضة قد ما تقدر`
    return `قرّب إبهامك من السبابة قد ما تقدر`
  }

  update(dt: number, input: CalibrationInput) {
    const step = this.steps[this.index]
    if (!step) return
    if (this.time === 0 && this.waited === 0) this.onStep?.(this.text(step))
    if (!input.visible(step.side)) {
      this.waited += dt
      if (this.waited > STEP_TIMEOUT_S) this.next(step)
      return
    }
    this.time += dt
    if (this.time > SETTLE_S) this.samples.push(step.kind === 'pinch' ? input.pinchCm(step.side) : input.closure(step.side))
    if (this.time >= STEP_S) this.next(step)
  }

  private next(step: Step) {
    if (this.samples.length >= 5) {
      const sorted = [...this.samples].sort((a, b) => a - b)
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
      // The patient's best, ignoring the odd stray frame: the most open, the most closed, the closest pinch.
      const value = step.kind === 'open' ? at(0.2) : step.kind === 'fist' ? at(0.9) : at(0.1)
      ;(this.raw[step.side] ??= {})[step.kind] = value
    }
    const neverSeen = this.time === 0 && this.samples.length === 0
    this.samples = []
    this.time = 0
    this.waited = 0
    this.index++
    // This hand never showed up for its first step: skip its other steps too.
    if (neverSeen && step.kind === 'open') {
      while (this.steps[this.index]?.side === step.side) this.index++
      return
    }
    // A side is finished: keep its range if it is a real measurement.
    const r = this.raw[step.side]
    if (step.kind === 'pinch' && r?.open !== undefined && r.fist !== undefined && r.fist - r.open >= MIN_RANGE) {
      this.results[step.side] = { open: r.open, fist: r.fist, pinchCm: r.pinch ?? 99 }
    }
  }
}
