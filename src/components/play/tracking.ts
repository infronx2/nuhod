/**
 * In-browser tracking: the Python pose server (ue5-game/pose_server.py, v3) ported to MediaPipe's
 * web tasks, so a phone tracks the patient itself. Same filters, same metric arm model, same hand
 * frame, finger curls and pinch, same units: centimetres relative to the midpoint between the eyes,
 * axes [forward, right, up] from the patient's point of view.
 */
import { FilesetResolver, HandLandmarker, HolisticLandmarker, PoseLandmarker, type Landmark } from '@mediapipe/tasks-vision'

/**
 * ?holistic (test option): Google's Holistic model instead of the pose and hand models. One model
 * finds the body and each hand from that arm's wrist, so a hand is tied to its arm from the start
 * (no left/right guessing) and hands near the face are found more often. Heavier; kept as an
 * option until it proves better and fast enough on phones.
 */
const HOLISTIC = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('holistic')
const HOLISTIC_MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task'

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
  /**
   * Where the hand is in the camera image: wrist position (0..1 of width and height) and the hand's
   * size there (wrist to middle knuckle, as a fraction of the image width), with its real length (cm).
   * Lets the hand keep moving when the body model loses the arm (hand close to the camera).
   */
  image?: {
    x: number; y: number; size: number; aspect: number; lengthCm: number
    /**
     * The palm's scale in the image: image widths per real centimetre, from the palm's three sides
     * (wrist–index knuckle, wrist–little knuckle, across the knuckles), which do not change as the
     * fingers bend. The largest of the three is used, since a tilted palm only shortens a side.
     */
    unitsPerCm: number
  }
  /**
   * The two hands overlap in the image (clasped, interlaced, one in front of the other): the finger
   * points are guesses then, so the game keeps the last good finger shape instead of showing them.
   */
  occluded?: boolean
}

export interface TrackFrame {
  body: boolean
  arms: Partial<Record<Side, ArmSample>>
  hands: Record<Side, HandSample>
  /**
   * Both shoulders in the camera image (x, y as fractions of the image width, so distances are
   * comparable both ways) and how sure the body model is of them: for the compensation check.
   */
  trunk?: { left: [number, number]; right: [number, number]; visibility: number }
  /** Each elbow in the camera image (x 0..1 of width, y 0..1 of height) and its visibility. */
  elbows?: Partial<Record<Side, { x: number; y: number; visibility: number }>>
  /** What the models saw, in image coordinates (0..1), for the inspection overlay (?inspect). */
  image?: { pose?: Landmark[]; hands: Partial<Record<Side, Landmark[]>> }
}

// ── Filtering (One Euro, as in the pose server) ─────────────────────────────
export class OneEuro {
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

/**
 * One Euro per point and axis, with two guards in front of it: a point the model is unsure of keeps
 * its last position, and a jump faster than a real arm moves is cut to that speed (a single bad frame
 * otherwise throws the hand across the room).
 */
class PointsFilter {
  private f: OneEuro[][] = []
  private last: Vec[] | null = null
  private lastT = 0
  /** axes: [minCutoff, beta] for x, y and depth; maxSpeed in input units per second. */
  constructor(private axes: Array<[number, number]>, private maxSpeed = Infinity) {}
  reset() { this.f = []; this.last = null }
  apply(points: Vec[], t: number, unsure?: boolean[]): Vec[] {
    if (this.f.length !== points.length) {
      this.f = points.map(() => this.axes.map(([minCutoff, beta]) => new OneEuro(30, minCutoff, beta)))
      this.last = null
    }
    const maxStep = this.maxSpeed * Math.min(0.2, Math.max(1 / 120, t - this.lastT))
    const input = points.map((p, i) => {
      const prev = this.last?.[i]
      if (!prev) return p
      if (unsure?.[i]) return prev
      const d = sub(p, prev)
      const n = norm(d)
      return n > maxStep ? add(prev, scale(d, maxStep / n)) : p
    })
    this.last = input
    this.lastT = t
    return input.map((p, i) => [0, 1, 2].map((k) => this.f[i][k].filter(p[k], t)) as Vec)
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
/** Below this the model is guessing a pose point (hidden or blurred); it keeps its last place. */
const UNSURE_VISIBILITY = 0.35
/** Image-width fraction under which a hand's side is decided by where that hand was, not by the pose. */
const SIDE_CLOSE_CALL = 0.06
const FINGERS: Array<[number, number, number, number]> = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]

export class Tracker {
  private pose: PoseLandmarker | null = null
  private hands: HandLandmarker | null = null
  private holistic: HolisticLandmarker | null = null
  /** Which models are tracking: 'holistic' or the usual 'pose+hands'. */
  get mode() { return this.holistic ? 'holistic' : 'pose+hands' }
  // Metres. Depth from one camera is the noisiest axis, so it is smoothed hardest; a rehab reach stays
  // well under 2 m/s.
  private poseFilter = new PointsFilter([[0.9, 2.5], [0.9, 2.5], [0.35, 1.0]], 2.0)
  private handFilters: Record<Side, PointsFilter> = {
    right: new PointsFilter([[1.0, 2.0], [1.0, 2.0], [0.6, 1.0]]),
    left: new PointsFilter([[1.0, 2.0], [1.0, 2.0], [0.6, 1.0]]),
  }
  /** Each hand's last wrist in the image, to keep left and right from swapping on close calls. */
  private lastWrist: Record<Side, Landmark | null> = { right: null, left: null }
  private handLastSeen: Record<Side, number> = { right: 0, left: 0 }
  private angleFilters = new Map<string, OneEuro>()
  private lastMs = -1
  private segment: Record<Side, [number | null, number | null]> = { right: [null, null], left: [null, null] }

  static async create(base = '/play'): Promise<Tracker> {
    const t = new Tracker()
    // Our own copy first; the same version from the npm CDN if it is missing from this deployment.
    const cdn = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
    const ours = await fetch(`${base}/wasm/vision_wasm_internal.wasm`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)
    const files = await FilesetResolver.forVisionTasks(ours ? `${base}/wasm` : cdn)
    // GPU where it works (iPhone, most Android); CPU otherwise.
    const make = async <T>(fn: (delegate: 'GPU' | 'CPU') => Promise<T>) => {
      try { return await fn('GPU') } catch (e) {
        console.warn('[play] GPU delegate failed, using CPU', e)
        return await fn('CPU')
      }
    }
    // The full pose model places the arm (and its depth) noticeably better than lite; lite stays for
    // phones with little memory, or ?lite.
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    const lite = (memory !== undefined && memory <= 3) || new URLSearchParams(window.location.search).has('lite')
    if (HOLISTIC) {
      const local = `${base}/models/holistic_landmarker.task`
      const haveLocal = await fetch(local, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)
      try {
        t.holistic = await make((delegate) => HolisticLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: haveLocal ? local : HOLISTIC_MODEL_CDN, delegate },
          runningMode: 'VIDEO',
          minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minHandLandmarksConfidence: 0.6,
          minFaceDetectionConfidence: 0.5,
        }))
        console.info('[play] tracking with the Holistic model')
        return t
      } catch (e) {
        console.warn('[play] Holistic model failed, using pose + hands', e)
      }
    }
    t.pose = await make((delegate) => PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}/models/pose_landmarker_${lite ? 'lite' : 'full'}.task`, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.65,
    }))
    t.hands = await make((delegate) => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}/models/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
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

  /** Tracks one video frame. Timestamps are forced to increase: MediaPipe's graph stops for good on one that goes back. */
  process(video: HTMLVideoElement | HTMLCanvasElement, frameMs: number): TrackFrame {
    const timeMs = Math.max(Math.round(frameMs), this.lastMs + 1)
    this.lastMs = timeMs
    const t = timeMs / 1000
    const out: TrackFrame = {
      body: false,
      arms: {},
      hands: { right: emptyHand(), left: emptyHand() },
      image: { hands: {} },
    }
    const vw = (video as HTMLVideoElement).videoWidth || video.width || 1
    const vh = (video as HTMLVideoElement).videoHeight || video.height || 1
    const aspect = vh / vw

    // The body and the hands found in this frame, by either set of models.
    let poseImage: Landmark[] | undefined
    let poseWorld: Landmark[] | undefined
    let found: Array<{ side: Side; lm: Landmark[]; world: Landmark[] }> = []
    if (this.holistic) {
      const r = this.holistic.detectForVideo(video, timeMs)
      poseImage = r.poseLandmarks?.[0]
      poseWorld = r.poseWorldLandmarks?.[0]
      found = holisticHands(r.rightHandLandmarks?.[0], r.rightHandWorldLandmarks?.[0], r.leftHandLandmarks?.[0], r.leftHandWorldLandmarks?.[0], poseImage)
    } else {
      const pr = this.pose!.detectForVideo(video, timeMs)
      poseImage = pr.landmarks?.[0]
      poseWorld = pr.worldLandmarks?.[0]
      const hr = this.hands!.detectForVideo(video, timeMs)
      if (hr.worldLandmarks?.length && hr.landmarks?.length) {
        const sides = assignHandSides(hr.landmarks, hr.handedness, poseImage, this.lastWrist)
        found = (Object.entries(sides) as Array<[Side, number]>).map(([side, i]) => ({ side, lm: hr.landmarks[i], world: hr.worldLandmarks[i] }))
      }
    }

    out.image!.pose = poseImage
    if (poseImage) {
      const ls = poseImage[L_SH], rs = poseImage[R_SH]
      out.trunk = {
        left: [ls.x, ls.y * aspect], right: [rs.x, rs.y * aspect],
        visibility: Math.min(ls.visibility ?? 1, rs.visibility ?? 1),
      }
      out.elbows = {
        right: { x: poseImage[R_EL].x, y: poseImage[R_EL].y, visibility: poseImage[R_EL].visibility ?? 1 },
        left: { x: poseImage[L_EL].x, y: poseImage[L_EL].y, visibility: poseImage[L_EL].visibility ?? 1 },
      }
    }
    if (poseWorld && poseImage) {
      const vis = poseWorld.map((p) => p.visibility ?? 1)
      const world = this.poseFilter.apply(poseWorld.map((p) => [p.x, p.y, p.z] as Vec), t, vis.map((v) => v < UNSURE_VISIBILITY))
      out.body = true
      out.arms = this.extractArms(world.map((p) => toGame({ x: p[0], y: p[1], z: p[2], visibility: 1 })), vis, t)
    }

    for (const { side, lm, world: raw } of found) {
      this.lastWrist[side] = lm[0]
      out.image!.hands[side] = lm
      const world = this.handFilters[side].apply(raw.map((p) => [p.x, p.y, p.z] as Vec), t)
      const Hd = world.map((p) => toGame({ x: p[0], y: p[1], z: p[2], visibility: 1 }))
      const { dir, normal } = handFrame(Hd, side)
      const imgLen = (a: number, b: number) => Math.hypot(lm[b].x - lm[a].x, (lm[b].y - lm[a].y) * aspect)
      const palm: Array<[number, number]> = [[0, 5], [0, 17], [5, 17]]
      const unitsPerCm = Math.max(...palm.map(([a, b]) => imgLen(a, b) / Math.max(norm(sub(Hd[b], Hd[a])), 0.5)))
      const image = {
        x: lm[0].x, y: lm[0].y, aspect,
        size: imgLen(0, 9),
        lengthCm: norm(sub(Hd[9], Hd[0])),
        unitsPerCm,
      }
      out.hands[side] = { tracked: true, points: Hd, dir, normal, curls: fingerCurls(Hd), pinchCm: norm(sub(Hd[4], Hd[8])), image }
      this.handLastSeen[side] = t
    }
    // Hands overlapping in the image: their finger points are guesses.
    if (found.length === 2 && boxOverlap(found[0].lm, found[1].lm, aspect) > HANDS_OVERLAP) {
      out.hands.right.occluded = true
      out.hands.left.occluded = true
    }
    for (const side of ['right', 'left'] as Side[]) {
      if (!out.hands[side].tracked && t - this.handLastSeen[side] > HAND_LOST_RESET_S) {
        this.handFilters[side].reset()
        this.lastWrist[side] = null
      }
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
    this.holistic?.close()
  }
}

/**
 * The Holistic model's two hands, each on the patient's side. It finds each hand from that arm's
 * wrist; as a guard (its left/right naming is not documented for an unmirrored camera), a hand
 * whose wrist sits clearly nearer the other arm's wrist is moved to that side.
 */
function holisticHands(
  rightLm: Landmark[] | undefined, rightWorld: Landmark[] | undefined,
  leftLm: Landmark[] | undefined, leftWorld: Landmark[] | undefined,
  pose: Landmark[] | undefined,
): Array<{ side: Side; lm: Landmark[]; world: Landmark[] }> {
  const hands: Array<{ side: Side; lm: Landmark[]; world: Landmark[] }> = []
  if (rightLm?.length === 21 && rightWorld?.length === 21) hands.push({ side: 'right', lm: rightLm, world: rightWorld })
  if (leftLm?.length === 21 && leftWorld?.length === 21) hands.push({ side: 'left', lm: leftLm, world: leftWorld })
  if (!pose) return hands
  const near = (h: Landmark[], w: number) => Math.hypot(h[0].x - pose[w].x, h[0].y - pose[w].y)
  for (const h of hands) {
    const own = near(h.lm, h.side === 'right' ? R_WR : L_WR)
    const other = near(h.lm, h.side === 'right' ? L_WR : R_WR)
    if (other + SIDE_CLOSE_CALL < own) h.side = h.side === 'right' ? 'left' : 'right'
  }
  // Both ended on one side: keep the nearer one there.
  if (hands.length === 2 && hands[0].side === hands[1].side) {
    const w = hands[0].side === 'right' ? R_WR : L_WR
    const far = near(hands[0].lm, w) > near(hands[1].lm, w) ? 0 : 1
    hands[far].side = hands[far].side === 'right' ? 'left' : 'right'
  }
  return hands
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

/** Share of the smaller hand's box covered by the other hand's box above which the hands overlap. */
const HANDS_OVERLAP = 0.3

function boxOverlap(a: Landmark[], b: Landmark[], aspect: number) {
  const box = (h: Landmark[]) => {
    const xs = h.map((p) => p.x), ys = h.map((p) => p.y * aspect)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  const [ax0, ay0, ax1, ay1] = box(a), [bx0, by0, bx1, by1] = box(b)
  const w = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0))
  const h = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0))
  const smaller = Math.min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
  return smaller > 0 ? (w * h) / smaller : 0
}

/** How sure the hand model must be of a hand's shape (right or left) to overrule the arms. */
const HANDEDNESS_SURE = 0.85
/** Two detections closer than this on average (image fraction) are the same hand found twice. */
const SAME_HAND = 0.035

function sameHand(a: Landmark[], b: Landmark[]) {
  let sum = 0
  for (let k = 0; k < 21; k++) sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)
  return sum / 21 < SAME_HAND
}

/** Each detected hand to the patient's left/right arm by wrist proximity in the image. */
function assignHandSides(
  landmarks: Landmark[][],
  handedness: Array<Array<{ categoryName: string; score?: number }>>,
  pose: Landmark[] | undefined,
  last: Record<Side, Landmark | null>,
): Partial<Record<Side, number>> {
  // The same hand found twice (hands together, fingers interlaced): keep the surer detection only.
  if (landmarks.length === 2 && sameHand(landmarks[0], landmarks[1])) {
    const keep = (handedness[0]?.[0]?.score ?? 0) >= (handedness[1]?.[0]?.score ?? 0) ? 0 : 1
    landmarks = [landmarks[keep]]
    handedness = [handedness[keep]]
    const only = assignHandSides(landmarks, handedness, pose, last)
    const side = Object.keys(only)[0] as Side | undefined
    return side ? { [side]: keep } : {}
  }
  // What the hand model itself sees: the shape of a right or a left hand. MediaPipe labels assume a
  // mirrored selfie image; the camera feed here is not mirrored.
  const shapeSide = (i: number): { side: Side; sure: boolean } => {
    const h = handedness[i]?.[0]
    return { side: h?.categoryName === 'Left' ? 'right' : 'left', sure: (h?.score ?? 0) >= HANDEDNESS_SURE }
  }
  const det = landmarks.map((lm, i) => {
    if (pose) {
      const dr = Math.hypot(lm[0].x - pose[R_WR].x, lm[0].y - pose[R_WR].y)
      const dl = Math.hypot(lm[0].x - pose[L_WR].x, lm[0].y - pose[L_WR].y)
      // Close call (hands near each other or crossed, or the pose wrist lagging): the hand's own
      // shape decides when the model is sure of it; otherwise stay with the side this hand had.
      const shape = shapeSide(i)
      if (Math.abs(dl - dr) < SIDE_CLOSE_CALL && shape.sure) return { i, side: shape.side, margin: SIDE_CLOSE_CALL }
      if (Math.abs(dl - dr) < SIDE_CLOSE_CALL && last.right && last.left) {
        const lr = Math.hypot(lm[0].x - last.right.x, lm[0].y - last.right.y)
        const ll = Math.hypot(lm[0].x - last.left.x, lm[0].y - last.left.y)
        return lr <= ll ? { i, side: 'right' as Side, margin: ll - lr } : { i, side: 'left' as Side, margin: lr - ll }
      }
      return dr <= dl ? { i, side: 'right' as Side, margin: dl - dr } : { i, side: 'left' as Side, margin: dr - dl }
    }
    return { i, side: shapeSide(i).side, margin: 0 }
  })
  if (det.length === 2 && det[0].side === det[1].side) {
    const weaker = det[0].margin < det[1].margin ? 0 : 1
    det[weaker].side = det[weaker].side === 'right' ? 'left' : 'right'
  }
  const out: Partial<Record<Side, number>> = {}
  for (const d of det) out[d.side] = d.i
  return out
}
