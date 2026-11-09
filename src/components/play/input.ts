/**
 * Grip and grabbing, ported from NuhoudInputAdapter.cpp: adaptive fist and pinch thresholds that
 * follow the patient's own best grip, grabbing when a closed hand meets an object (or rests on it),
 * a release debounce against camera noise, and the "glow what you could pick up" hint.
 */
import * as THREE from 'three'
import type { RiggedHand } from './hands'
import { perceived, type Grabbable, type Grip } from './props'
import type { ArmSample, HandSample, Side } from './tracking'

const TRACKING_GRACE_S = 0.35
const HAND_STALE_S = 0.6
const CLOSURE_CEILING_DECAY = 0.01
const PINCH_MARGIN_CM = 1.8, PINCH_ON_MIN = 3.5, PINCH_ON_MAX = 5.5, PINCH_RELEASE_EXTRA = 1.5, PINCH_FLOOR_RISE = 0.05
const PINCH_REACH = 9, GRASP_REACH = 13
const GRAB_WINDOW_S = 0.8, DWELL_GRAB_S = 0.3, RELEASE_DEBOUNCE_S = 0.3

export interface GripEvents {
  onGrab(pinch: boolean, side: Side): void
  onGripSample(closure: number, pinchCm: number): void
}

class SideState {
  arm: ArmSample | null = null
  hand: HandSample | null = null
  lastArm = -1e9
  lastHand = -1e9
  closure = 0
  closureCeiling = 0
  graspOn = 0.45
  pinchFloor = 99
  pinchOnCm = PINCH_ON_MIN
  grasping = false
  pinching = false
  graspStart = -1e9
  pinchStart = -1e9
  held: Grabbable | null = null
  heldGrip: Grip = 'grasp'
  openTime = 0
  dwellTarget: Grabbable | null = null
  dwellTime = 0
  prevPalm: THREE.Vector3 | null = null
  palmVelocity = new THREE.Vector3()
  /** The hand's closure when opened as far as the patient can (from the calibration; 0 if none). */
  openClosure = 0
  /** The last moment both the arm and the hand were seen: the arm then, and the hand in the image. */
  anchor: { arm: ArmSample; image: NonNullable<HandSample['image']>; t: number } | null = null
}

/**
 * Hand seen, arm lost (the hand close to the camera hides the face and shoulder from the body
 * model): the arm as last seen, moved by how far the hand has moved in the camera image since.
 * Across the image the hand's own size gives the scale (its real length over its length in the
 * image = centimetres per image width at its depth); toward the camera its growth gives the depth,
 * assuming a usual 60° webcam, damped since that guess is rough. For display only: the therapy
 * angles keep coming from the body model.
 */
const HAND_ONLY_HOLD_S = 4
const WEBCAM_FOCAL = 0.5 / Math.tan(THREE.MathUtils.degToRad(30))
const DEPTH_TRUST = 0.7
const MAX_DEPTH_SHIFT_CM = 40

function armFromImage(anchor: NonNullable<SideState['anchor']>, now: NonNullable<HandSample['image']>): ArmSample {
  const a = anchor.image
  const len = (a.lengthCm + now.lengthCm) / 2
  const at = (p: NonNullable<HandSample['image']>) => {
    const widthCm = len / Math.max(p.size, 1e-3)
    return [(p.x - 0.5) * widthCm, (p.y - 0.5) * widthCm * p.aspect, WEBCAM_FOCAL * widthCm]
  }
  const [xa, ya, za] = at(a), [xn, yn, zn] = at(now)
  // Image right is the patient's left, image down is down, nearer the camera is forward.
  const fwd = THREE.MathUtils.clamp(-(zn - za) * DEPTH_TRUST, -MAX_DEPTH_SHIFT_CM, MAX_DEPTH_SHIFT_CM)
  const d: [number, number, number] = [fwd, -(xn - xa), -(yn - ya)]
  const w = anchor.arm.wrist, e = anchor.arm.elbow
  return {
    ...anchor.arm,
    wrist: [w[0] + d[0], w[1] + d[1], w[2] + d[2]],
    // The elbow follows part of the way, so the forearm turns rather than slides.
    elbow: [e[0] + d[0] * 0.5, e[1] + d[1] * 0.5, e[2] + d[2] * 0.5],
  }
}

export class HandInput {
  private s: Record<Side, SideState> = { right: new SideState(), left: new SideState() }
  /** Which hands the plan uses. */
  active: Record<Side, boolean> = { right: true, left: true }

  constructor(private hands: Record<Side, RiggedHand>, private grabbables: () => Grabbable[], private events: GripEvents) {}

  feed(side: Side, arm: ArmSample | undefined, hand: HandSample, now: number) {
    const st = this.s[side]
    if (arm?.tracked) {
      st.arm = arm
      st.lastArm = now
    }
    if (hand.tracked) {
      st.hand = hand
      st.lastHand = now
    }
    if (arm?.tracked && hand.tracked && hand.image) st.anchor = { arm, image: hand.image, t: now }
  }

  isVisible(side: Side) { return this.hands[side].visible }
  palm(side: Side) { return this.hands[side].palm }
  holding(side: Side) { return this.s[side].held }
  closure(side: Side) { return this.s[side].closure }
  pinchCm(side: Side) { return this.s[side].hand?.pinchCm ?? 99 }

  /**
   * This patient's range for one hand, from the calibration: the fist threshold sits between their
   * most open and most closed hand, and the pinch threshold just above their closest pinch.
   */
  calibrate(side: Side, range: { open: number; fist: number; pinchCm: number }) {
    const st = this.s[side]
    st.openClosure = range.open
    st.closureCeiling = Math.max(st.closureCeiling, range.fist)
    if (range.pinchCm < 30) st.pinchFloor = range.pinchCm
  }

  update(now: number, dt: number) {
    for (const side of ['right', 'left'] as Side[]) {
      this.updateHand(side, now, dt)
      this.updateGrip(side, now, dt)
    }
  }

  private updateHand(side: Side, now: number, dt: number) {
    const st = this.s[side], h = this.hands[side]
    const handFresh = now - st.lastHand < TRACKING_GRACE_S
    let arm = now - st.lastArm < TRACKING_GRACE_S && this.active[side] ? st.arm : null
    // Arm lost but the hand still seen: keep the hand on screen, moving with the camera image.
    if (!arm && this.active[side] && handFresh && st.anchor && st.hand?.image && now - st.anchor.t < HAND_ONLY_HOLD_S) {
      arm = armFromImage(st.anchor, st.hand.image)
    }
    h.setVisible(!!arm)
    if (!arm) return
    // Keep a closed hand closed through finger dropouts so a held object is not shown slipping out.
    const keepLast = !handFresh && st.held && st.hand
    h.update(arm, handFresh || keepLast ? st.hand : null, dt)
  }

  private updateGripState(st: SideState, now: number, dt: number) {
    if (now - st.lastHand > HAND_STALE_S || !st.hand) return
    st.closure = closureOf(st.hand.curls)
    // The grasp threshold follows the patient's best recent closure, so a weak grip still registers.
    st.closureCeiling = Math.max(st.closure, st.closureCeiling - dt * CLOSURE_CEILING_DECAY)
    // Calibrated: 62% of the way from this patient's open hand to their best fist (a hand that
    // cannot open fully still has to close clearly). Otherwise from 0, as before.
    const base = st.openClosure
    st.graspOn = base > 0
      ? THREE.MathUtils.clamp(base + (st.closureCeiling - base) * 0.62, Math.max(0.18, base + 0.08), 0.55)
      : THREE.MathUtils.clamp(st.closureCeiling * 0.62, 0.3, 0.55)
    const graspOff = st.graspOn * 0.6
    // Cameras rarely measure touching fingertips as touching: the pinch threshold sits just above the patient's best pinch.
    st.pinchFloor = Math.min(st.hand.pinchCm, st.pinchFloor + dt * PINCH_FLOOR_RISE)
    st.pinchOnCm = THREE.MathUtils.clamp(st.pinchFloor + PINCH_MARGIN_CM, PINCH_ON_MIN, PINCH_ON_MAX)
    const grasp = st.grasping ? st.closure > graspOff : st.closure > st.graspOn
    const pinch = st.pinching ? st.hand.pinchCm < st.pinchOnCm + PINCH_RELEASE_EXTRA : st.hand.pinchCm < st.pinchOnCm
    if (grasp && !st.grasping) st.graspStart = now
    if (pinch && !st.pinching) st.pinchStart = now
    st.grasping = grasp
    st.pinching = pinch
    this.events.onGripSample(st.closure, st.hand.pinchCm)
  }

  private find(point: THREE.Vector3, grip: Grip, radius: number): { g: Grabbable; at: THREE.Vector3 } | null {
    let best: { g: Grabbable; at: THREE.Vector3 } | null = null
    let bestD = radius
    for (const g of this.grabbables()) {
      if (!g.canBeGrabbed() || !g.allowsGrip(grip)) continue
      const surface = g.closestSurfacePoint(point)
      const d = perceived(point, surface)
      if (d < bestD) {
        bestD = d
        best = { g, at: surface }
      }
    }
    return best
  }

  private gripPoint(h: RiggedHand, grip: Grip) { return grip === 'pinch' ? h.pinchPoint : h.graspPoint }

  private updateGrip(side: Side, now: number, dt: number) {
    const st = this.s[side], h = this.hands[side]
    if (!h.visible) {
      if (st.held) st.held.release(new THREE.Vector3())
      st.held = null
      st.prevPalm = null
      st.grasping = st.pinching = false
      st.dwellTarget = null
      return
    }
    const palm = h.palm
    if (st.prevPalm && dt > 1e-4) st.palmVelocity.lerp(palm.clone().sub(st.prevPalm).divideScalar(dt), 0.35)
    st.prevPalm = palm
    this.updateGripState(st, now, dt)

    const gripping = st.pinching || st.grasping
    h.setGripFeedback(st.held ? 1 : gripping ? 0.6 : 0)

    if (st.held) {
      const still = st.heldGrip === 'pinch' ? gripping : st.grasping
      st.openTime = still ? 0 : st.openTime + dt
      if (st.held.state !== 'held') st.held = null // the task placed or consumed it
      else if (st.openTime < RELEASE_DEBOUNCE_S) {
        st.held.updateHeld(this.gripPoint(h, st.heldGrip), null, dt)
        return
      } else {
        st.held.release(st.palmVelocity)
        st.held = null
      }
    }

    let target: { g: Grabbable; at: THREE.Vector3 } | null = null
    let grip: Grip = 'pinch'
    if (st.pinching) target = this.find(h.pinchPoint, 'pinch', PINCH_REACH)
    if (!target && st.grasping) {
      target = this.find(h.graspPoint, 'grasp', GRASP_REACH)
      grip = 'grasp'
    }
    if (target) {
      // Grab when the hand closes on the object, or when an already-closed hand rests on it briefly.
      const start = grip === 'pinch' ? st.pinchStart : st.graspStart
      st.dwellTime = st.dwellTarget === target.g ? st.dwellTime + dt : 0
      st.dwellTarget = target.g
      if (now - start < GRAB_WINDOW_S || st.dwellTime >= DWELL_GRAB_S) {
        target.g.beginGrab(this.gripPoint(h, grip))
        st.held = target.g
        st.heldGrip = grip
        st.openTime = 0
        st.dwellTarget = null
        st.dwellTime = 0
        this.events.onGrab(grip === 'pinch', side)
        return
      }
    } else {
      st.dwellTarget = null
      st.dwellTime = 0
    }
    const near = this.find(h.pinchPoint, 'pinch', PINCH_REACH * 1.6) ?? this.find(h.graspPoint, 'grasp', GRASP_REACH * 1.5)
    near?.g.requestHighlight()
  }

  /** Grip and pinch status for the debug readout. */
  describe(side: Side) {
    const st = this.s[side]
    return `${Math.round(st.closure * 100)}% ${st.hand ? st.hand.pinchCm.toFixed(1) : '-'}cm${st.held ? ' HOLD' : st.grasping ? ' FIST' : st.pinching ? ' PINCH' : ''}`
  }
}

/** About 15° average MCP/PIP flexion for a relaxed open hand, about 70° for a firm fist (fingers only). */
function closureOf(curls: Array<[number, number, number]>) {
  if (curls.length < 5) return 0
  let sum = 0
  for (let f = 1; f < 5; f++) sum += (curls[f][0] + curls[f][1]) / 2
  return THREE.MathUtils.clamp((sum / 4 - 15) / 55, 0, 1)
}
