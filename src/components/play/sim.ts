/**
 * ?sim: a scripted patient for testing without a camera (the web twin of the fake pose server used
 * for the Unreal game). It reads the current task's targets and moves one arm through reach, grip,
 * carry and release, producing the same samples the camera tracker does.
 */
import * as THREE from 'three'
import { EYES } from './space'
import type { ArmSample, HandSample, TrackFrame, Vec } from './tracking'

export interface SimTargets {
  task: 'lantern' | 'serve' | 'eat' | null
  pick: THREE.Vector3 | null // the lantern, or a date in the bowl
  place: THREE.Vector3 | null // the hook, the plate, or the mouth
  holding: boolean
}

type Phase = 'rest' | 'reach' | 'grip' | 'carry' | 'hold' | 'release'
const OPEN: Array<[number, number, number]> = [[10, 10, 5], [12, 10, 5], [12, 10, 5], [12, 10, 5], [12, 10, 5]]
const FIST: Array<[number, number, number]> = [[40, 40, 30], [80, 95, 60], [80, 95, 60], [80, 95, 60], [80, 95, 60]]
const PINCH: Array<[number, number, number]> = [[30, 30, 20], [35, 55, 30], [40, 60, 30], [40, 60, 30], [40, 60, 30]]
const REST: Vec = [10, 18, -45]

/** Three.js world point to game cm relative to the eyes (forward, right, up). */
function toLocal(p: THREE.Vector3): Vec {
  const d = p.clone().sub(EYES)
  return [-d.z, d.x, d.y]
}

export class SimPatient {
  private phase: Phase = 'rest'
  private t0 = 0
  private from: Vec = REST
  private wrist: Vec = REST
  private grip: 'open' | 'fist' | 'pinch' = 'open'
  private lastTask: SimTargets['task'] = null

  frame(now: number, targets: SimTargets): TrackFrame {
    const t = now - this.t0
    const go = (p: Phase) => { this.phase = p; this.t0 = now; this.from = [...this.wrist] as Vec }
    const pinchTask = targets.task === 'serve' || targets.task === 'eat'
    // The wrist sits a little behind and above the point the fingers act on.
    const aim = (p: THREE.Vector3 | null, extra: Vec = [0, 0, 0]): Vec => {
      if (!p) return REST
      const l = toLocal(p)
      return pinchTask ? [l[0] - 9 + extra[0], l[1] + extra[1], l[2] + 2 + extra[2]] : [l[0] - 7 + extra[0], l[1] + extra[1], l[2] + 4 + extra[2]]
    }
    if (targets.task !== this.lastTask) {
      this.lastTask = targets.task
      go('rest')
    }
    let target: Vec = REST
    switch (this.phase) {
      case 'rest':
        this.grip = 'open'
        if (t > 1 && targets.task && targets.pick) go('reach')
        break
      case 'reach':
        target = aim(targets.pick)
        if (t > 2.2) go('grip')
        break
      case 'grip':
        target = aim(targets.pick)
        this.grip = pinchTask ? 'pinch' : 'fist'
        if (t > 0.8) go(targets.holding ? 'carry' : 'reach')
        break
      case 'carry':
        // The lantern's ring is about 8 cm above its centre, under the hook.
        target = aim(targets.place, targets.task === 'lantern' ? [0, 0, -9] : [0, 0, 0])
        if (t > 2.5) go('hold')
        break
      case 'hold':
        target = aim(targets.place, targets.task === 'lantern' ? [0, 0, -9] : [0, 0, 0])
        if (t > 1.5 || !targets.holding) go('release')
        break
      case 'release':
        this.grip = 'open'
        target = this.wrist
        if (t > 1) go('rest')
        break
    }
    const k = Math.min(1, t / 1.8)
    const e = k * k * (3 - 2 * k)
    if (this.phase !== 'release') this.wrist = this.from.map((v, i) => v + (target[i] - v) * e) as Vec
    const elbow: Vec = [this.wrist[0] - 24, this.wrist[1] + 4, this.wrist[2] - 10]
    const arm: ArmSample = {
      tracked: true, shoulder: [-4, 17, -24], elbow, wrist: this.wrist, upperArmCm: 30, forearmCm: 26,
      shoulderElevation: 20 + Math.max(0, this.wrist[2] + 45) * 1.2, elbowAngle: 120,
    }
    const curls = this.grip === 'fist' ? FIST : this.grip === 'pinch' ? PINCH : OPEN
    const hand: HandSample = {
      tracked: true, points: [], dir: [1, 0, 0], normal: [0, 0, -1], curls,
      pinchCm: this.grip === 'pinch' ? 2.4 : 7,
    }
    return {
      body: true,
      arms: { right: arm },
      hands: { right: hand, left: { tracked: false, points: [], dir: [1, 0, 0], normal: [0, 0, -1], curls: [], pinchCm: 99 } },
    }
  }
}
