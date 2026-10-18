/**
 * In-browser tracking: the Python pose server (ue5-game/pose_server.py, v3) ported to MediaPipe's
 * web tasks, so a phone tracks the patient itself. Same filters, same metric arm model, same hand
 * frame, finger curls and pinch, same units: centimetres relative to the midpoint between the eyes,
 * axes [forward, right, up] from the patient's point of view.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker, type Landmark } from '@mediapipe/tasks-vision'

export type Vec = [number, number, number]
export type Side = 'right' | 'left'

export interface ArmSample {
  tracked: boolean
  shoulder: Vec
  elbow: Vec
  wrist: Vec
  upperArmCm: number
  forearmCm: number
  shoulderElevation: number
  elbowAngle: number
}

export interface HandSample {
  tracked: boolean
  /** The 21 hand landmarks in game cm, relative to the hand's own centre (not placed in the room). */
  points: Vec[]
  dir: Vec
  normal: Vec
  /** Per finger [mcp, pip, dip] flexion in degrees, thumb first. */
  curls: Array<[number, number, number]>
  pinchCm: number
}

export interface TrackFrame {
  body: boolean
  arms: Partial<Record<Side, ArmSample>>
  hands: Record<Side, HandSample>
}

// ── Filtering (One Euro, as in the pose server) ─────────────────────────────
class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0
  constructor(private freq = 30, private minCutoff = 1, private beta = 0.007, private dCutoff = 1) {}
  private alpha(cutoff: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau * this.freq)
  }
  filter(x: number, t: number) {
    if (this.x === null) {
      this.x = x
      this.t = t
      return x
    }
    let dt = t - this.t
    if (dt <= 0) dt = 1 / this.freq
    this.freq = 1 / dt
    this.t = t
    const ad = this.alpha(this.dCutoff)
    const dx = (x - this.x) * this.freq
    this.dx = ad * dx + (1 - ad) * this.dx
    const a = this.alpha(this.minCutoff + this.beta * Math.abs(this.dx))
    this.x = a * x + (1 - a) * this.x
    return this.x
  }
}

class PointsFilter {
  private f: OneEuro[][] = []
  constructor(private minCutoff: number, private beta: number) {}
  reset() { this.f = [] }
  apply(points: Vec[], t: number): Vec[] {
    if (this.f.length !== points.length) {
      this.f = points.map(() => [0, 1, 2].map(() => new OneEuro(30, this.minCutoff, this.beta)))
    }
    return points.map((p, i) => [0, 1, 2].map((k) => this.f[i][k].filter(p[k], t)) as Vec)
  }
}

// ── Vector math ─────────────────────────────────────────────────────────────
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec) => Math.sqrt(dot(a, a))
const mid = (a: Vec, b: Vec) => scale(add(a, b), 0.5)
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a: Vec): Vec => {
  const n = norm(a)
  return n < 1e-9 ? [0, 0, 0] : scale(a, 1 / n)
}
const orthonormal = (v: Vec, ref: Vec) => normalize(sub(v, scale(ref, dot(v, ref))))
const angleDeg = (a: Vec, b: Vec) => {
  const n = norm(a) * norm(b)
  return n < 1e-9 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / n))) * 180) / Math.PI
}

/** MediaPipe world metres (x image-right, y down, z away from the camera) to game cm (forward, right, up),
 *  for an un-mirrored front camera: the image's right is the patient's left. */
const toGame = (p: Landmark): Vec => [-p.z * 100, -p.x * 100, -p.y * 100]

// Pose landmark indices.
const L_EYE = 2, R_EYE = 5, L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24
const ARM_IDS: Record<Side, [number, number, number]> = { right: [R_SH, R_EL, R_WR], left: [L_SH, L_EL, L_WR] }
const VISIBILITY_MIN = 0.5
const HAND_LOST_RESET_S = 0.4
const FINGERS: Array<[number, number, number, number]> = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]

export class Tracker {
  private pose!: PoseLandmarker
  private hands!: HandLandmarker
  private poseFilter = new PointsFilter(1.2, 4.0)
  private handFilters: Record<Side, PointsFilter> = { right: new PointsFilter(1.5, 3.0), left: new PointsFilter(1.5, 3.0) }
  private handLastSeen: Record<Side, number> = { right: 0, left: 0 }
  private angleFilters = new Map<string, OneEuro>()
  private segment: Record<Side, [number | null, number | null]> = { right: [null, null], left: [null, null] }

  static async create(base = '/play'): Promise<Tracker> {
    const t = new Tracker()
    const files = await FilesetResolver.forVisionTasks(`${base}/wasm`)
    // GPU where it works (iPhone, most Android); CPU otherwise.
    const make = async <T>(fn: (delegate: 'GPU' | 'CPU') => Promise<T>) => {
      try { return await fn('GPU') } catch { return await fn('CPU') }
    }
    t.pose = await make((delegate) => PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}/models/pose_landmarker_lite.task`, delegate },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.6, minTrackingConfidence: 0.6,
    }))
    t.hands = await make((delegate) => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}/models/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.5,
    }))
    return t
  }

  private filtAngle(key: string, value: number, t: number) {
    let f = this.angleFilters.get(key)
    if (!f) this.angleFilters.set(key, (f = new OneEuro(30, 1.0, 0.02)))
    return f.filter(value, t)
  }

  private stableLength(side: Side, idx: 0 | 1, measured: number) {
    const cur = this.segment[side][idx]
    const next = cur === null ? measured : cur + (measured - cur) * 0.02
    this.segment[side][idx] = next
    return next
  }

  /** Tracks one video frame. timeMs must increase from frame to frame. */
  process(video: HTMLVideoElement, timeMs: number): TrackFrame {
    const t = timeMs / 1000
    const out: TrackFrame = {
      body: false,
      arms: {},
      hands: { right: emptyHand(), left: emptyHand() },
    }
    const pr = this.pose.detectForVideo(video, timeMs)
    const poseImage = pr.landmarks?.[0]
    if (pr.worldLandmarks?.[0] && poseImage) {
      const raw = pr.worldLandmarks[0]
      const vis = raw.map((p) => p.visibility ?? 1)
      const world = this.poseFilter.apply(raw.map((p) => [p.x, p.y, p.z] as Vec), t)
      out.body = true
      out.arms = this.extractArms(world.map((p) => toGame({ x: p[0], y: p[1], z: p[2], visibility: 1 })), vis, t)
    }

    const hr = this.hands.detectForVideo(video, timeMs)
    if (hr.worldLandmarks?.length && hr.landmarks?.length) {
      const sides = assignHandSides(hr.landmarks, hr.handedness, poseImage)
      for (const [side, i] of Object.entries(sides) as Array<[Side, number]>) {
        const world = this.handFilters[side].apply(hr.worldLandmarks[i].map((p) => [p.x, p.y, p.z] as Vec), t)
        const Hd = world.map((p) => toGame({ x: p[0], y: p[1], z: p[2], visibility: 1 }))
        const { dir, normal } = handFrame(Hd, side)
        out.hands[side] = { tracked: true, points: Hd, dir, normal, curls: fingerCurls(Hd), pinchCm: norm(sub(Hd[4], Hd[8])) }
        this.handLastSeen[side] = t
      }
    }
    for (const side of ['right', 'left'] as Side[]) {
      if (!out.hands[side].tracked && t - this.handLastSeen[side] > HAND_LOST_RESET_S) this.handFilters[side].reset()
    }
    return out
  }

  private extractArms(G: Vec[], vis: number[], t: number): Partial<Record<Side, ArmSample>> {
    const eyes = mid(G[L_EYE], G[R_EYE])
    const midSh = mid(G[L_SH], G[R_SH])
    const down: Vec = vis[L_HIP] > VISIBILITY_MIN && vis[R_HIP] > VISIBILITY_MIN
      ? normalize(sub(mid(G[L_HIP], G[R_HIP]), midSh))
      : [0, 0, -1]
    const arms: Partial<Record<Side, ArmSample>> = {}
    for (const side of ['right', 'left'] as Side[]) {
      const [s, e, w] = ARM_IDS[side]
      const upper = sub(G[e], G[s])
      const fore = sub(G[w], G[e])
      const u = normalize(upper), f = normalize(fore)
      const lu = this.stableLength(side, 0, norm(upper))
      const lf = this.stableLength(side, 1, norm(fore))
      const shoulder = sub(G[s], eyes)
      const elbow = add(shoulder, scale(u, lu))
      const wrist = add(elbow, scale(f, lf))
      arms[side] = {
        tracked: Math.min(vis[s], vis[e], vis[w]) > VISIBILITY_MIN,
        shoulder, elbow, wrist,
        upperArmCm: lu,
        forearmCm: lf,
        shoulderElevation: this.filtAngle(side + 'elev', (Math.acos(Math.max(-1, Math.min(1, dot(u, down)))) * 180) / Math.PI, t),
        elbowAngle: this.filtAngle(side + 'elbow', angleDeg(scale(u, -1), f), t),
      }
    }
    return arms
  }

  close() {
    this.pose?.close()
    this.hands?.close()
  }
}

function emptyHand(): HandSample {
  return { tracked: false, points: [], dir: [1, 0, 0], normal: [0, 0, -1], curls: [], pinchCm: 99 }
}

/** Finger direction (wrist to middle knuckle) and palm normal (out of the palm). */
function handFrame(Hd: Vec[], side: Side) {
  const dir = normalize(sub(Hd[9], Hd[0]))
  const thumbSide = normalize(sub(Hd[5], Hd[17]))
  const palm = side === 'right' ? cross(dir, thumbSide) : cross(thumbSide, dir)
  return { dir, normal: orthonormal(palm, dir) }
}

function fingerCurls(Hd: Vec[]): Array<[number, number, number]> {
  return FINGERS.map(([a, b, c, tip]) => [
    Math.max(0, 180 - angleDeg(sub(Hd[0], Hd[a]), sub(Hd[b], Hd[a]))),
    Math.max(0, 180 - angleDeg(sub(Hd[a], Hd[b]), sub(Hd[c], Hd[b]))),
    Math.max(0, 180 - angleDeg(sub(Hd[b], Hd[c]), sub(Hd[tip], Hd[c]))),
  ])
}

/** Each detected hand to the patient's left/right arm by wrist proximity in the image. */
function assignHandSides(
  landmarks: Landmark[][],
  handedness: Array<Array<{ categoryName: string }>>,
  pose?: Landmark[],
): Partial<Record<Side, number>> {
  const det = landmarks.map((lm, i) => {
    if (pose) {
      const dr = Math.hypot(lm[0].x - pose[R_WR].x, lm[0].y - pose[R_WR].y)
      const dl = Math.hypot(lm[0].x - pose[L_WR].x, lm[0].y - pose[L_WR].y)
      return dr <= dl ? { i, side: 'right' as Side, margin: dl - dr } : { i, side: 'left' as Side, margin: dr - dl }
    }
    // MediaPipe labels assume a mirrored selfie image; the camera feed here is not mirrored.
    const label = handedness[i]?.[0]?.categoryName
    return { i, side: (label === 'Left' ? 'right' : 'left') as Side, margin: 0 }
  })
  if (det.length === 2 && det[0].side === det[1].side) {
    const weaker = det[0].margin < det[1].margin ? 0 : 1
    det[weaker].side = det[weaker].side === 'right' ? 'left' : 'right'
  }
  const out: Partial<Record<Side, number>> = {}
  for (const d of det) out[d.side] = d.i
  return out
}
