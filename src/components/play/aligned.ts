/**
 * Camera-aligned hands (AR placement). The hand is drawn where it is in the camera picture, as in a
 * mirror: up, down, left and right one to one, because the hand model's 2D points are its most
 * accurate output. Only the depth is estimated: from how large the palm looks against how large the
 * shoulders look, i.e. how far the hand is in front of the body, so reaching toward the camera
 * reaches into the room.
 *
 * Before, the hand was placed from the body model's 3D arm, whose depth is weak when the arm points
 * at the camera: hands raised to the face were drawn down by the table, and hands at the chest went
 * off screen. The therapy angles still come from the body model; this only places what is shown.
 */
import * as THREE from 'three'
import { OneEuro, type ArmSample, type Side, type TrackFrame, type Vec } from './tracking'

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
/** Usual 60° webcam: image widths per unit of distance, used to turn sizes into distances. */
const WEBCAM_FOCAL = 0.5 / Math.tan(THREE.MathUtils.degToRad(30))
const SHOULDER_CM = 38
/** Eye-to-hand distance in the room for a hand held at the body, and how much a reach adds. */
const REACH_BASE_CM = 32
const REACH_GAIN = 1
const MIN_DIST_CM = 30
const MAX_DIST_CM = 95
/** ?aligngain=1.2 spreads the camera picture wider over the screen; ?alignv=-0.05 moves it up. */
const GAIN = Number(params?.get('aligngain') ?? 1) || 1
const V_OFFSET = Number(params?.get('alignv') ?? 0) || 0

/** three.js world point → game cm from the eyes (forward, right, up). */
function toGameFrom(eyes: THREE.Vector3, p: THREE.Vector3): Vec {
  const d = p.clone().sub(eyes)
  return [-d.z, d.x, d.y]
}

export class CameraAlign {
  private bodyDist: number | null = null
  private filters: Record<Side, [OneEuro, OneEuro, OneEuro]> = {
    right: [new OneEuro(30, 1.2, 0.02), new OneEuro(30, 1.2, 0.02), new OneEuro(30, 0.6, 0.004)],
    left: [new OneEuro(30, 1.2, 0.02), new OneEuro(30, 1.2, 0.02), new OneEuro(30, 0.6, 0.004)],
  }
  private lastSeen: Record<Side, number> = { right: -1e9, left: -1e9 }

  constructor(private camera: THREE.PerspectiveCamera) {}

  /**
   * The arm to show for this side, placed from the camera picture; null when the hand is not seen.
   * The body model's arm (when there is one) supplies the forearm length and the therapy values.
   */
  arm(side: Side, f: TrackFrame, body: ArmSample | undefined, t: number): ArmSample | null {
    const hand = f.hands[side]
    const img = hand.image
    if (!hand.tracked || !img || img.unitsPerCm <= 0) return null
    // A hand seen again after a while starts its filters afresh (no glide from the old place).
    if (t - this.lastSeen[side] > 0.5) this.filters[side] = [new OneEuro(30, 1.2, 0.02), new OneEuro(30, 1.2, 0.02), new OneEuro(30, 0.6, 0.004)]
    this.lastSeen[side] = t

    if (f.trunk && f.trunk.visibility > 0.5) {
      const [lx, ly] = f.trunk.left, [rx, ry] = f.trunk.right
      const width = Math.hypot(rx - lx, ry - ly)
      if (width > 0.02) {
        const d = (WEBCAM_FOCAL * SHOULDER_CM) / width
        this.bodyDist = this.bodyDist === null ? d : this.bodyDist + (d - this.bodyDist) * 0.05
      }
    }
    const handDist = WEBCAM_FOCAL / img.unitsPerCm
    const reach = THREE.MathUtils.clamp((this.bodyDist ?? handDist + 20) - handDist, -15, 75)
    const [fx, fy, fd] = this.filters[side]
    const x = fx.filter(img.x, t), y = fy.filter(img.y, t)
    const dist = fd.filter(THREE.MathUtils.clamp(REACH_BASE_CM + reach * REACH_GAIN, MIN_DIST_CM, MAX_DIST_CM), t)
    const wrist = this.onScreen(x, y, img.aspect, dist)

    // The forearm: toward the elbow as the camera sees it, at the patient's forearm length.
    const forearm = body && body.forearmCm > 10 ? body.forearmCm : 26
    const e = f.elbows?.[side]
    let toElbow: THREE.Vector3
    if (e && e.visibility > 0.5) {
      const elbowDist = THREE.MathUtils.clamp(REACH_BASE_CM * 0.9 + reach * 0.35, MIN_DIST_CM * 0.8, MAX_DIST_CM)
      toElbow = this.onScreen(e.x, e.y, img.aspect, elbowDist).sub(wrist)
    } else {
      toElbow = new THREE.Vector3(0, -0.55, 0.85) // down and back toward the patient
    }
    if (toElbow.lengthSq() < 1e-6) toElbow.set(0, -0.55, 0.85)
    const elbow = wrist.clone().addScaledVector(toElbow.normalize(), forearm)

    const eyes = this.camera.position
    const base: ArmSample = body ?? {
      tracked: true, shoulder: [0, side === 'right' ? 18 : -18, -24], elbow: [0, 0, 0], wrist: [0, 0, 0],
      upperArmCm: 28, forearmCm: forearm, shoulderElevation: 0, elbowAngle: 0,
    }
    return { ...base, tracked: true, wrist: toGameFrom(eyes, wrist), elbow: toGameFrom(eyes, elbow) }
  }

  /**
   * A camera-picture point (x, y in 0..1) on the game screen, `dist` cm from the eyes along that
   * line of sight. The picture is mirrored (the patient's right hand on the right of the screen) and
   * fitted inside the screen keeping its shape, so a hand inside the camera is always on screen.
   */
  private onScreen(x: number, y: number, camAspect: number, dist: number): THREE.Vector3 {
    const screenAspect = 1 / this.camera.aspect // height / width
    const fit = Math.min(1, screenAspect / camAspect) * GAIN
    const u = 0.5 + (0.5 - x) * fit
    const v = 0.5 + ((y - 0.5) * camAspect * fit) / screenAspect + V_OFFSET
    const p = new THREE.Vector3(u * 2 - 1, -(v * 2 - 1), 0.5).unproject(this.camera)
    const dir = p.sub(this.camera.position).normalize()
    return this.camera.position.clone().addScaledVector(dir, dist)
  }
}
