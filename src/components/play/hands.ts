/**
 * Realistic hands: the WebXR generic-hand meshes (MIT, @webxr-input-profiles/assets) driven by
 * MediaPipe's 21 landmarks per hand. The 25 WebXR joints follow the WebXR convention three.js uses
 * for real hand tracking: each bone's -Z points along the finger toward the tip and +Y out of the
 * back of the hand, positions in metres in the hand root's space.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { EYES, ue } from './space'
import { texture } from './assets'
import type { ArmSample, HandSample, Side, Vec } from './tracking'

const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
]

/** For each WebXR joint: the MediaPipe landmark it sits on, or [wrist, knuckle, share] for the
 *  finger metacarpals, which MediaPipe does not track (they sit a quarter of the way to the knuckle). */
const SOURCE: Array<number | [number, number, number]> = [
  0,
  1, 2, 3, 4,
  [0, 5, 0.25], 5, 6, 7, 8,
  [0, 9, 0.25], 9, 10, 11, 12,
  [0, 13, 0.25], 13, 14, 15, 16,
  [0, 17, 0.25], 17, 18, 19, 20,
]
/** The joint each joint points at (tips point like their parent). */
const CHILD = [10, 2, 3, 4, -3, 6, 7, 8, 9, -8, 11, 12, 13, 14, -13, 16, 17, 18, 19, -18, 21, 22, 23, 24, -23]

/** A relaxed open right hand, palm down, fingers forward, in game cm from the wrist (for when only the arm is tracked). */
const OPEN_RIGHT: Vec[] = [
  [0, 0, 0], [2, -2.5, -0.5], [3.8, -4.2, -0.8], [5.4, -5.4, -0.8], [6.8, -6.3, -0.8],
  [9, -2.2, 0], [12.5, -2.4, -0.3], [14.8, -2.5, -0.6], [16.7, -2.6, -0.9],
  [9.3, 0, 0], [13.2, 0, -0.3], [15.8, 0, -0.6], [17.8, 0, -0.9],
  [9, 2, 0], [12.5, 2.1, -0.3], [14.8, 2.2, -0.6], [16.6, 2.3, -0.9],
  [8.2, 3.8, 0], [11, 4.2, -0.3], [12.8, 4.5, -0.6], [14.3, 4.7, -0.9],
]

/**
 * A right hand's 21 landmarks (game cm from the wrist: forward, right, up; palm down) built from
 * finger bend angles in degrees ([knuckle, middle, end] per finger, thumb first): used when the
 * camera gives only how closed the hand is (the scripted patient), so the hand still makes a real
 * fist or pinch instead of staying flat.
 */
const KNUCKLES: Vec[] = [[2, -2.5, -0.5], [9, -2.2, 0], [9.3, 0, 0], [9, 2, 0], [8.2, 3.8, 0]]
const SEGMENTS: Vec[] = [[3.0, 2.6, 2.0], [3.6, 2.3, 1.9], [3.9, 2.6, 2.0], [3.6, 2.4, 1.9], [2.9, 1.9, 1.6]]
const SPLAY = [0, -6, 0, 5, 11]
export function handFromCurls(curls: Array<[number, number, number]>): Vec[] {
  const out: Vec[] = [[0, 0, 0]]
  const rad = THREE.MathUtils.degToRad
  for (let f = 0; f < 5; f++) {
    const c = curls[f] ?? [10, 10, 5]
    let p = new THREE.Vector3(...KNUCKLES[f])
    out.push(p.toArray() as Vec)
    if (f === 0) {
      // Thumb: out from the base of the palm, folding across the palm as it closes.
      const base = new THREE.Vector3(0.65, -0.65, -0.35).normalize()
      const across = new THREE.Vector3(0.25, 0.8, -0.55).normalize()
      let a = 0
      for (let k = 0; k < 3; k++) {
        a += rad(c[k]) * 0.9
        const d = base.clone().multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a)).normalize()
        p = p.clone().addScaledVector(d, SEGMENTS[0][k])
        out.push(p.toArray() as Vec)
      }
      continue
    }
    const s = rad(SPLAY[f])
    const fwd = new THREE.Vector3(Math.cos(s), Math.sin(s), 0)
    const down = new THREE.Vector3(0, 0, -1)
    let a = 0
    for (let k = 0; k < 3; k++) {
      a += rad(c[k])
      const d = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(down, Math.sin(a))
      p = p.clone().addScaledVector(d, SEGMENTS[f][k])
      out.push(p.toArray() as Vec)
    }
  }
  return out
}

/**
 * Joint limits of a real finger (degrees of bend toward the palm) and the extra closing given to a
 * strong bend: the camera reads a closed fist as only partly closed (the fingers hide each other),
 * so bends past BOOST_FROM are stretched by BOOST, up to the limit.
 */
const FINGER_LIMITS: Array<[number, number]> = [[-25, 95], [0, 110], [0, 85]]
const MAX_SPREAD_DEG = 35
const BOOST_FROM = 35
const BOOST = 1.3

/**
 * Makes the four fingers anatomically possible, in place (world cm, MediaPipe landmark order). Each
 * finger keeps its knuckle, its bone lengths and its spread, but bends in one plane only (no sideways
 * kink at the middle joints, which the camera invents when fingers hide each other, e.g. palm up) and
 * within a real finger's joint limits; strong bends close a little further so a fist looks closed.
 * The thumb is left as tracked. Works for both hands: the back of the hand comes from the side.
 */
export function constrainFingers(T: THREE.Vector3[], side: Side) {
  const fwdRaw = new THREE.Vector3().subVectors(T[9], T[0])
  const thumbSide = new THREE.Vector3().subVectors(T[5], T[17])
  if (fwdRaw.lengthSq() < 1e-6 || thumbSide.lengthSq() < 1e-6) return
  const n = side === 'right'
    ? new THREE.Vector3().crossVectors(fwdRaw, thumbSide).normalize()
    : new THREE.Vector3().crossVectors(thumbSide, fwdRaw).normalize()
  const x = fwdRaw.clone().addScaledVector(n, -fwdRaw.dot(n)).normalize()
  const y = new THREE.Vector3().crossVectors(n, x)
  const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg
  const boost = (a: number) => (a <= BOOST_FROM ? a : BOOST_FROM + (a - BOOST_FROM) * BOOST)
  const seg = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3()
  for (const base of [5, 9, 13, 17]) {
    const [k, p, d, tip] = [base, base + 1, base + 2, base + 3]
    const len = [T[p].distanceTo(T[k]), T[d].distanceTo(T[p]), T[tip].distanceTo(T[d])]
    if (len.some((l) => l < 1e-3)) continue
    // Knuckle: spread in the palm plane, bend toward the palm (-n).
    seg.subVectors(T[p], T[k])
    // The spread only means something while the finger is not bent far down (else it is noise).
    const flat = Math.hypot(seg.dot(x), seg.dot(y)) / seg.length()
    const spread = THREE.MathUtils.clamp(deg(Math.atan2(seg.dot(y), seg.dot(x))), -MAX_SPREAD_DEG, MAX_SPREAD_DEG)
      * THREE.MathUtils.smoothstep(flat, 0.3, 0.7)
    let bend = deg(Math.atan2(-seg.dot(n), Math.hypot(seg.dot(x), seg.dot(y))))
    // Middle and end joints: how far each bends from the bone before it (always toward the palm).
    a.subVectors(T[p], T[k]); b.subVectors(T[d], T[p])
    let pip = deg(a.angleTo(b))
    a.copy(b); b.subVectors(T[tip], T[d])
    let dip = deg(a.angleTo(b))
    bend = THREE.MathUtils.clamp(bend > 0 ? boost(bend) : bend, ...FINGER_LIMITS[0])
    pip = THREE.MathUtils.clamp(boost(pip), ...FINGER_LIMITS[1])
    dip = THREE.MathUtils.clamp(boost(dip), ...FINGER_LIMITS[2])
    // Rebuild the finger in its plane: forward along its spread, bending toward the palm.
    const s = rad(spread)
    const fwd = x.clone().multiplyScalar(Math.cos(s)).addScaledVector(y, Math.sin(s))
    let angle = 0
    const bends = [bend, pip, dip], joints = [p, d, tip]
    let from = T[k].clone()
    for (let j = 0; j < 3; j++) {
      angle += rad(bends[j])
      const dir = fwd.clone().multiplyScalar(Math.cos(angle)).addScaledVector(n, -Math.sin(angle))
      from = from.addScaledVector(dir, len[j])
      T[joints[j]].copy(from)
      from = from.clone()
    }
  }
}

/**
 * Comfortable viewing distance (cm from the eyes). A hand raised in front of the face to show the
 * camera sits 15-25 cm from the eyes, where it fills the screen. Hands nearer than this are pushed
 * out along the line of sight, softly: they stay on the same spot of the screen, only smaller, and
 * the game's distances (which count depth along the line of sight 2.5 times less) barely change.
 * The arm angles used for therapy are measured before this and are not affected.
 */
const NEAR_CM = 36
const NEAR_SOFT_CM = 6

/** A wrist (game cm from the eyes: forward, right, up) moved out to a comfortable viewing distance. */
export function comfortReach([f, r, u]: Vec): Vec {
  const d = Math.hypot(f, r, u)
  if (d < 1e-3) return [NEAR_CM, r, u]
  const x = (d - NEAR_CM) / NEAR_SOFT_CM
  // Smooth maximum of d and NEAR_CM: equal to d well beyond it, NEAR_CM + a little well inside.
  const out = NEAR_CM + NEAR_SOFT_CM * (x > 20 ? x : Math.log1p(Math.exp(x)))
  const s = out / d
  return [f * s, r * s, u * s]
}

const SKIN = new THREE.Color().setRGB(0.58, 0.38, 0.28, THREE.SRGBColorSpace)
const DISHDASHA = new THREE.Color().setRGB(0.93, 0.91, 0.86, THREE.SRGBColorSpace)
/** How fast the shown hand catches up with the tracked one (per second), and the jump that is shown at once. */
const FOLLOW_RATE = 18
const FOLLOW_SNAP_CM = 45
/** How long a hand the camera loses keeps its last finger shape (s). */
const HOLD_SHAPE_S = 0.5
/** Forearm (cm): the dishdasha sleeve ends this far before the wrist, leaving a bare wrist; its radius at the cuff and at the elbow. */
const CUFF_BEFORE_WRIST = 6
const REAL_CUFF_BEFORE_WRIST = 0.8
const SLEEVE_RADIUS_CUFF = 4.1
const SLEEVE_RADIUS_ELBOW = 5.4
const WRIST_RADIUS = 2.55
const FOREARM_RADIUS = 3.1

/**
 * The realistic hand (Sketchfab "Rigged hand", a right hand with skin, veins, knuckles and nails):
 * each deforming bone and the MediaPipe landmarks its direction follows ([from, to]). The left hand
 * is the same model mirrored. The rest pose gives each bone's direction and the back of the hand;
 * every frame each bone turns by the rotation that takes that rest frame to the tracked one.
 */
const REAL_MAP: Array<[RegExp, number, number]> = [
  [/^pulse.?R/, 0, 9], [/^hand.?R_/, 0, 9],
  [/^thumb_base.?R/, 0, 1], [/^thumb_01.?R/, 1, 2], [/^thumb_02.?R/, 2, 3], [/^thumb_03.?R_\d/, 3, 4],
  [/^index_base.?R/, 0, 5], [/^index_01.?R/, 5, 6], [/^index_02.?R/, 6, 7], [/^index_03.?R_\d/, 7, 8],
  [/^middle_base.?R/, 0, 9], [/^middle_01.?R/, 9, 10], [/^middle_02.?R/, 10, 11], [/^middle_03.?R_\d/, 11, 12],
  [/^ring_base.?R/, 0, 13], [/^ring_01.?R/, 13, 14], [/^ring_02.?R/, 14, 15], [/^ring_03.?R_\d/, 15, 16],
  [/^pinky_base.?R/, 0, 17], [/^pinky_01.?R/, 17, 18], [/^pinky_02.?R/, 18, 19], [/^pinky_03.?R_\d/, 19, 20],
]
/** Bones whose rest positions stand for landmarks 0 (wrist), 5, 9 and 17 (index, middle, pinky knuckles). */
const REAL_ANCHORS = { wrist: /^hand.?R_/, index: /^index_01.?R/, middle: /^middle_01.?R/, pinky: /^pinky_01.?R/ }

/**
 * The metacarpal bones (thumb and finger bases): their pivots sit inside the palm, away from the
 * wrist, so they aim from where they are to their knuckle instead of following wrist → knuckle.
 */
const REAL_BASES = new Set([2, 6, 10, 14, 18])
/**
 * Which axis fixes a bone's roll. The four fingers bend toward the palm, so their direction can
 * line up with the back of the hand (at a 90° bend) but never with the hand's width (index → little
 * finger knuckles): they use the width. The thumb, the hand and the forearm use the back of the hand.
 */
const useWidth = (i: number) => i >= 6
/**
 * The thumb's three phalanges cannot twist on their own: each one keeps its parent's roll and only
 * swings to its tracked direction. (A roll taken from the back of the hand flips when the thumb
 * points out of the palm, which wrung the skin into a swollen, twisted thumb.)
 */
const SWING_ONLY = new Set([3, 4, 5])

interface RealRig {
  root: THREE.Group
  bones: THREE.Bone[]
  restQ: THREE.Quaternion[]
  restBasis: THREE.Quaternion[]
  /** Each bone's local rotation and its direction in its own frame, in the rest pose. */
  restLocal: THREE.Quaternion[]
  restDirLocal: THREE.Vector3[]
  restHandLen: number
  material: THREE.MeshPhysicalMaterial
}

/**
 * Rotation whose z axis is `dir` and whose y axis is `ref` made perpendicular to it. If `ref` lies
 * almost along `dir` (its perpendicular part under 0.35), `alt` takes over smoothly, so the frame
 * never flips.
 */
function frame(dir: THREE.Vector3, ref: THREE.Vector3, alt: THREE.Vector3, out: THREE.Quaternion) {
  const z = dir.clone().normalize()
  const y1 = ref.clone().addScaledVector(z, -ref.dot(z))
  const w = THREE.MathUtils.smoothstep(y1.length(), 0.15, 0.35)
  const y2 = alt.clone().addScaledVector(z, -alt.dot(z)).normalize()
  const y = y1.normalize().multiplyScalar(w).addScaledVector(y2, 1 - w)
  y.addScaledVector(z, -y.dot(z)).normalize()
  const x = new THREE.Vector3().crossVectors(y, z)
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/**
 * A dishdasha sleeve along +y (0 = cuff, 1 = elbow end): a slightly oval tube of soft cotton that
 * gathers into uneven diagonal folds near the cuff and the bend of the elbow, with a wavy hem that
 * turns inward (no hard rim), so it reads as cloth, not a cup.
 */
function sleeveGeometry(r0: number, r1: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 64, 40, true)
  g.translate(0, 0.5, 0)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const a = Math.atan2(p.getZ(i), p.getX(i))
    let r = r0 + (r1 - r0) * Math.sqrt(y)
    // Gathered folds: strong at the cuff and the elbow, calm in the middle; diagonal like real cotton.
    const gather = Math.exp(-y * 7) + 0.6 * Math.exp(-(1 - y) * 6)
    r *= 1 + gather * (0.09 * Math.sin(a * 5 + y * 22) + 0.05 * Math.sin(a * 9 - y * 31 + 1.3))
    r *= 1 + 0.025 * Math.sin(a * 3 + y * 9) + 0.015 * Math.sin(a * 2 - y * 14)
    // Slightly flattened across the forearm.
    const ox = 1.08, oz = 0.92
    // The hem rolls inward over the last few millimetres.
    const hem = y < 0.03 ? 1 - (0.03 - y) * 3 : 1
    p.setXYZ(i, Math.cos(a) * r * ox * hem, y + (y < 0.02 ? 0.004 * Math.sin(a * 6) : 0), Math.sin(a) * r * oz * hem)
  }
  g.computeVertexNormals()
  return g
}

/** A tube along +y from 0 to 1 whose radius goes from r0 to r1, with soft cloth folds when `folds`. */
function tube(r0: number, r1: number, folds: boolean): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 32, 8, true)
  g.translate(0, 0.5, 0)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const a = Math.atan2(z, x)
    let r = r0 + (r1 - r0) * y
    if (folds) r *= 1 + 0.045 * Math.sin(a * 7 + y * 5) * (0.4 + y) + 0.02 * Math.sin(a * 13 - y * 9)
    p.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r)
  }
  g.computeVertexNormals()
  return g
}

export class RiggedHand {
  readonly root = new THREE.Group()
  /** The forearm in a white dishdasha sleeve, in room space (cm); the game adds it to the scene. */
  readonly forearm = new THREE.Group()
  private sleeve: THREE.Mesh
  private cuff: THREE.Mesh
  private bareWrist: THREE.Mesh
  private elbow = new THREE.Vector3()
  private elbowTarget = new THREE.Vector3()
  private bones: THREE.Bone[] = []
  private material: THREE.MeshPhysicalMaterial
  /** Joint positions this frame (three.js cm, world space), in MediaPipe landmark order. */
  readonly landmarks: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3())
  /** Where the tracker says the landmarks are; the shown hand eases toward them every rendered frame. */
  private target: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3())
  private snap = true
  /** The last tracked finger shape (offsets from the wrist) and how long ago it was seen (s). */
  private heldShape: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3())
  private heldShapeAge = Infinity
  readonly dorsal = new THREE.Vector3(0, 1, 0)
  visible = false
  /** Rebuild the four fingers from their bend angles within a real hand's limits (see constrainFingers). */
  anatomy = true

  constructor(readonly side: Side) {
    this.root.scale.setScalar(100) // the asset is in metres, the scene in centimetres
    // Skin: a soft sheen for the fine hair and oil of real skin, a faint clear coat on the knuckles.
    this.material = new THREE.MeshPhysicalMaterial({
      color: SKIN, roughness: 0.52, metalness: 0,
      sheen: 0.18, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.85, 0.5, 0.4),
      clearcoat: 0.08, clearcoatRoughness: 0.55,
      emissive: new THREE.Color(0x3bb3bd), emissiveIntensity: 0,
    })
    const cloth = new THREE.MeshPhysicalMaterial({
      color: DISHDASHA, roughness: 0.88,
      sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(1, 1, 1),
      normalMap: texture('fabric_pattern_07', 'nor_gl', [6, 10]), normalScale: new THREE.Vector2(0.55, 0.55),
      side: THREE.FrontSide,
    })
    // The inside of the sleeve, in its own shadow.
    const lining = new THREE.MeshStandardMaterial({ color: DISHDASHA.clone().multiplyScalar(0.55), roughness: 0.95, side: THREE.BackSide })
    const geo = sleeveGeometry(SLEEVE_RADIUS_CUFF, SLEEVE_RADIUS_ELBOW)
    this.sleeve = new THREE.Mesh(geo, cloth)
    this.sleeve.add(new THREE.Mesh(geo, lining))
    // No separate rim: the hem is part of the sleeve. (Kept as an invisible holder for the code below.)
    this.cuff = new THREE.Mesh(new THREE.BufferGeometry(), cloth)
    this.cuff.visible = false
    this.bareWrist = new THREE.Mesh(tube(FOREARM_RADIUS, WRIST_RADIUS, false), this.material)
    for (const m of [this.sleeve, this.cuff, this.bareWrist]) {
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
    }
    const cuffHolder = new THREE.Group()
    cuffHolder.add(this.cuff)
    this.sleeve.add(cuffHolder)
    this.forearm.add(this.sleeve, this.bareWrist)
    this.forearm.visible = false
  }

  private real: RealRig | null = null
  private realScale = 0

  /**
   * Loads the realistic hand (one right-hand model, mirrored for the left). Rejects if the file or
   * its bones are missing, so the caller can fall back to the WebXR hand.
   */
  async loadRealistic(url: string) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(url)
    const model = gltf.scene
    const all: THREE.Bone[] = []
    model.traverse((o) => { if ((o as THREE.Bone).isBone) all.push(o as THREE.Bone) })
    const find = (re: RegExp) => all.find((b) => re.test(b.name))
    const bones = REAL_MAP.map(([re]) => find(re))
    const anchor = Object.fromEntries(Object.entries(REAL_ANCHORS).map(([k, re]) => [k, find(re)])) as Record<keyof typeof REAL_ANCHORS, THREE.Bone | undefined>
    if (bones.some((b) => !b) || Object.values(anchor).some((b) => !b)) throw new Error('realistic hand: bones missing')

    // Rest pose, measured relative to a root whose origin is the wrist.
    const root = new THREE.Group()
    const offset = new THREE.Group()
    root.add(offset)
    offset.add(model)
    root.updateMatrixWorld(true)
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
    offset.position.copy(wp(anchor.wrist!).negate())
    root.updateMatrixWorld(true)
    const restPos = (lm: number): THREE.Vector3 => {
      // Where each landmark sits in the rest pose: the bone the chain reaches at that landmark.
      const to = REAL_MAP.findIndex(([, , t]) => t === lm)
      const next = REAL_MAP.findIndex(([, f]) => f === lm)
      if (lm === 0) return wp(anchor.wrist!)
      if (next >= 0) return wp(bones[next]!)
      // A fingertip: the end bone under the last joint.
      const end = bones[to]!.children.find((c) => (c as THREE.Bone).isBone)
      return end ? wp(end) : wp(bones[to]!)
    }
    const P = Array.from({ length: 21 }, (_, i) => restPos(i))
    const restDorsal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(P[9], P[0]), new THREE.Vector3().subVectors(P[5], P[17])).normalize()
    const restWidth = new THREE.Vector3().subVectors(P[5], P[17]).normalize()
    const restQ = bones.map((b) => b!.getWorldQuaternion(new THREE.Quaternion()))
    // The first bone (pulse, the end of the forearm) follows the forearm, elbow to wrist; the
    // metacarpals aim from their own pivot; the other bones follow their two landmarks.
    const restBasis = REAL_MAP.map(([, f, t], i) => {
      const dir = i === 0 ? new THREE.Vector3().subVectors(wp(bones[1]!), wp(bones[0]!))
        : REAL_BASES.has(i) ? new THREE.Vector3().subVectors(P[t], wp(bones[i]!))
          : new THREE.Vector3().subVectors(P[t], P[f])
      return useWidth(i) ? frame(dir, restWidth, restDorsal, new THREE.Quaternion()) : frame(dir, restDorsal, restWidth, new THREE.Quaternion())
    })
    const restLocal = bones.map((b) => b!.quaternion.clone())
    const restDirLocal = REAL_MAP.map(([, f, t], i) =>
      new THREE.Vector3().subVectors(P[t], P[f]).normalize().applyQuaternion(restQ[i].clone().invert()))

    let material!: THREE.MeshPhysicalMaterial
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isSkinnedMesh) return
      m.frustumCulled = false
      m.castShadow = true
      m.receiveShadow = true
      const src = m.material as THREE.MeshStandardMaterial
      // Keep the scanned colour, but natural, unpainted nails and a soft skin sheen.
      material = new THREE.MeshPhysicalMaterial({
        map: src.map, roughnessMap: src.roughnessMap, metalnessMap: null, normalMap: src.normalMap,
        roughness: 0.62, metalness: 0, sheen: 0.2, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.85, 0.5, 0.4),
        color: new THREE.Color(0.93, 0.86, 0.82), emissive: new THREE.Color(0x3bb3bd), emissiveIntensity: 0,
        // Less of the bright sky window in the skin, so the back of the hand never washes out pale.
        envMapIntensity: 0.6,
      })
      m.material = material
    })
    // Remove the WebXR hand if it was loaded first; this rig replaces it.
    for (const c of [...this.root.children]) this.root.remove(c)
    this.root.scale.setScalar(1)
    this.root.add(root)
    this.real = { root, bones: bones as THREE.Bone[], restQ, restBasis, restLocal, restDirLocal, restHandLen: P[9].distanceTo(P[0]), material }
    // The scanned hand has its own wrist; the sleeve's cuff meets it directly.
    this.bareWrist.visible = false
    this.root.visible = false
  }

  /** Turns every bone of the realistic hand to the tracked landmarks (world cm). */
  private poseReal(rig: RealRig) {
    const L = this.landmarks
    const mirror = this.side === 'left' ? -1 : 1
    // Size the hand to the patient's: wrist to middle knuckle, eased so it never pulses.
    const target = L[9].distanceTo(L[0]) / rig.restHandLen
    this.realScale = this.realScale ? this.realScale + (target - this.realScale) * 0.05 : target
    rig.root.position.copy(L[0])
    rig.root.scale.set(mirror * this.realScale, this.realScale, this.realScale)
    rig.root.updateMatrixWorld(true)
    // Landmarks in the root's (mirrored for the left hand) space, where the model is a right hand.
    const inv = rig.root.matrixWorld.clone().invert()
    let local = L.map((p) => p.clone().applyMatrix4(inv))
    const dorsalOf = (P: THREE.Vector3[]) => new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(P[9], P[0]), new THREE.Vector3().subVectors(P[5], P[17])).normalize()
    const widthOf = (P: THREE.Vector3[]) => new THREE.Vector3().subVectors(P[5], P[17]).normalize()
    const q = new THREE.Quaternion(), delta = new THREE.Quaternion(), parentQ = new THREE.Quaternion()
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), t = new THREE.Vector3()
    const elbowLocal = this.elbow.clone().applyMatrix4(inv)
    let dorsal = dorsalOf(local), width = widthOf(local)
    for (let i = 0; i < REAL_MAP.length; i++) {
      const [, f, to] = REAL_MAP[i]
      const bone = rig.bones[i]
      const dir = i === 0 ? new THREE.Vector3().subVectors(local[0], elbowLocal)
        : REAL_BASES.has(i) ? new THREE.Vector3().subVectors(local[to], bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv))
          : new THREE.Vector3().subVectors(local[to], local[f])
      if (dir.lengthSq() < 1e-8) continue
      if (SWING_ONLY.has(i)) {
        // Parent's current rotation with this bone at rest, then the shortest swing onto the target.
        m.multiplyMatrices(inv, bone.parent!.matrixWorld).decompose(t, parentQ, s)
        const unswung = parentQ.clone().multiply(rig.restLocal[i])
        const now = rig.restDirLocal[i].clone().applyQuaternion(unswung)
        const swing = new THREE.Quaternion().setFromUnitVectors(now, dir.normalize())
        bone.quaternion.copy(rig.restLocal[i]).premultiply(parentQ.clone().invert().multiply(swing).multiply(parentQ))
        bone.updateMatrixWorld(true)
        continue
      }
      if (useWidth(i)) frame(dir, width, dorsal, q)
      else frame(dir, dorsal, width, q)
      delta.copy(q).multiply(rig.restBasis[i].clone().invert())
      const desired = delta.multiply(rig.restQ[i])
      m.multiplyMatrices(inv, bone.parent!.matrixWorld).decompose(t, parentQ, s)
      bone.quaternion.copy(parentQ.invert().multiply(desired))
      bone.updateMatrixWorld(true)
      // Turning the forearm end moves the wrist joint: shift the whole hand so the wrist stays on the
      // tracked wrist, and re-express the landmarks in the shifted space.
      if (i === 0) {
        const w = rig.bones[1].getWorldPosition(new THREE.Vector3())
        rig.root.position.add(new THREE.Vector3().subVectors(L[0], w))
        rig.root.updateMatrixWorld(true)
        inv.copy(rig.root.matrixWorld).invert()
        local = L.map((p) => p.clone().applyMatrix4(inv))
        dorsal = dorsalOf(local)
        width = widthOf(local)
      }
    }
    // The back of the hand, in world space, for grabbing (as for the WebXR hand).
    const dirW = new THREE.Vector3().subVectors(L[9], L[0]).normalize()
    const thumbSide = new THREE.Vector3().subVectors(L[5], L[17]).normalize()
    this.dorsal.crossVectors(this.side === 'right' ? dirW : thumbSide, this.side === 'right' ? thumbSide : dirW).normalize()
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url)
    const armature = gltf.scene.children[0]
    this.root.add(armature)
    const mesh = armature.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.material = this.material
    this.bones = JOINTS.map((n) => armature.getObjectByName(n) as THREE.Bone)
    this.root.visible = false
  }

  /**
   * The sleeve from just behind the elbow to its cuff, then the bare wrist into the hand. Uses the
   * shown (eased) wrist so the forearm and the hand never separate.
   */
  private placeForearm() {
    const wrist = this.landmarks[0]
    const d = new THREE.Vector3().subVectors(wrist, this.elbow)
    const len = d.length()
    if (len < 8) return
    d.divideScalar(len)
    // The scanned hand carries a short forearm of its own (about 2.6 cm): the sleeve reaches past its
    // cut end to just before the wrist, so no bare stump or gap ever shows between sleeve and hand.
    const cuff = wrist.clone().addScaledVector(d, this.real ? -REAL_CUFF_BEFORE_WRIST : -CUFF_BEFORE_WRIST)
    const start = this.elbow.clone().addScaledVector(d, -4)
    const up = new THREE.Vector3(0, 1, 0)
    // Sleeve: y = 0 at the cuff, y = 1 at the elbow end; its cuff ring stays round (scaled back).
    const sleeveLen = cuff.distanceTo(start)
    this.sleeve.position.copy(cuff)
    this.sleeve.quaternion.setFromUnitVectors(up, d.clone().negate())
    this.sleeve.scale.set(1, sleeveLen, 1)
    this.cuff.parent!.scale.set(1, 1 / sleeveLen, 1)
    // Bare wrist: from inside the sleeve to just inside the hand mesh.
    const skinStart = cuff.clone().addScaledVector(d, -1.5)
    this.bareWrist.position.copy(skinStart)
    this.bareWrist.quaternion.setFromUnitVectors(up, d)
    this.bareWrist.scale.set(1, skinStart.distanceTo(wrist) + 0.8, 1)
  }

  /** Glow while the camera sees a closed hand (0.6) or the hand holds something (1). */
  setGripFeedback(level: number) {
    if (this.material) this.material.emissiveIntensity = level * 0.18
    // Not on the realistic skin: a teal glow over brown skin read as grey, bloodless and ghostly.
    // The held object glows instead.
    if (this.real) this.real.material.emissiveIntensity = 0
  }

  /**
   * Places the hand: the wrist at the arm model's wrist, the fingers from the hand landmarks, or an
   * open hand along the forearm when the fingers are not tracked.
   */
  update(tracked: ArmSample, hand: HandSample | null, dt: number) {
    // Shown at a comfortable distance from the eyes; the elbow moves with the wrist so the forearm
    // keeps its length and direction.
    const w = comfortReach(tracked.wrist)
    const shift: Vec = [w[0] - tracked.wrist[0], w[1] - tracked.wrist[1], w[2] - tracked.wrist[2]]
    const arm: ArmSample = {
      ...tracked, wrist: w,
      elbow: [tracked.elbow[0] + shift[0], tracked.elbow[1] + shift[1], tracked.elbow[2] + shift[2]],
    }
    const wrist = EYES.clone().add(ue(...arm.wrist))
    if (hand?.tracked && hand.points.length === 21) {
      const o = hand.points[0]
      for (let i = 0; i < 21; i++) {
        const p = hand.points[i]
        this.target[i].copy(wrist).add(ue(p[0] - o[0], p[1] - o[1], p[2] - o[2]))
      }
      if (this.anatomy) constrainFingers(this.target, this.side)
      for (let i = 0; i < 21; i++) this.heldShape[i].subVectors(this.target[i], wrist)
      this.heldShapeAge = 0
    } else if (this.heldShapeAge < HOLD_SHAPE_S) {
      // Briefly hidden (behind the other hand, or a missed frame): keep the last finger shape on the
      // arm's wrist instead of snapping to an open hand.
      this.heldShapeAge += dt
      for (let i = 0; i < 21; i++) this.target[i].copy(wrist).add(this.heldShape[i])
    } else {
      this.openHandAlongForearm(arm, wrist, hand?.tracked && hand.curls.length === 5 ? handFromCurls(hand.curls) : OPEN_RIGHT)
    }
    // The camera gives ~30 updates a second and the screen draws 60+: ease between them so the hand
    // glides instead of stepping, and jump straight there when it reappears or truly moved far.
    const far = this.landmarks[0].distanceTo(this.target[0]) > FOLLOW_SNAP_CM
    const k = this.snap || far ? 1 : 1 - Math.exp(-dt * FOLLOW_RATE)
    for (let i = 0; i < 21; i++) this.landmarks[i].lerp(this.target[i], k)
    this.elbowTarget.copy(EYES).add(ue(...arm.elbow))
    this.elbow.lerp(this.elbowTarget, k)
    this.snap = false
    if (this.real) this.poseReal(this.real)
    else this.pose()
    this.placeForearm()
  }

  /** No finger tracking: an open hand along the forearm, palm down (three.js axes: x right, y up, -z forward). */
  private openHandAlongForearm(arm: ArmSample, wrist: THREE.Vector3, shape: Vec[] = OPEN_RIGHT) {
    const f = ue(arm.wrist[0] - arm.elbow[0], arm.wrist[1] - arm.elbow[1], arm.wrist[2] - arm.elbow[2]).normalize()
    if (f.lengthSq() < 0.5) f.set(0, 0, -1)
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize()
    if (right.lengthSq() < 0.5) right.set(1, 0, 0)
    const up = new THREE.Vector3().crossVectors(right, f).normalize()
    const mirror = this.side === 'left' ? -1 : 1
    for (let i = 0; i < 21; i++) {
      const [x, y, z] = shape[i]
      this.target[i].copy(wrist).addScaledVector(f, x).addScaledVector(right, y * mirror).addScaledVector(up, z)
    }
  }

  private pose() {
    const L = this.landmarks
    // Back of the hand: in three.js's right-handed axes a right hand's dorsal side is fingers x thumb-side.
    const dir = new THREE.Vector3().subVectors(L[9], L[0]).normalize()
    const thumbSide = new THREE.Vector3().subVectors(L[5], L[17]).normalize()
    this.dorsal.crossVectors(this.side === 'right' ? dir : thumbSide, this.side === 'right' ? thumbSide : dir).normalize()

    const pos = SOURCE.map((s) => (typeof s === 'number' ? L[s].clone() : L[s[0]].clone().lerp(L[s[1]], s[2])))
    const m = new THREE.Matrix4()
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3()
    for (let j = 0; j < 25; j++) {
      const bone = this.bones[j]
      if (!bone) continue
      const c = CHILD[j]
      // +Z points back from the joint toward the wrist; tips reuse the direction of their parent bone.
      if (c >= 0) z.subVectors(pos[j], pos[c])
      else z.subVectors(pos[-c], pos[j])
      if (z.lengthSq() < 1e-6) continue
      z.normalize()
      y.copy(this.dorsal).addScaledVector(z, -this.dorsal.dot(z)).normalize()
      x.crossVectors(y, z)
      m.makeBasis(x, y, z)
      bone.quaternion.setFromRotationMatrix(m)
      bone.position.copy(pos[j]).multiplyScalar(0.01)
    }
  }

  setVisible(v: boolean) {
    if (!v) this.snap = true
    this.visible = v
    this.root.visible = v
    this.forearm.visible = v
  }

  /**
   * For the hand lab (/play/lab): how far each bone of the realistic hand points from the landmarks
   * it follows, in degrees; how far its palm faces from the landmarks' palm; and how far its wrist
   * joint sits from the tracked wrist, in cm. Null for the WebXR hand.
   */
  measure(): { bones: Array<{ name: string; errDeg: number }>; palmDeg: number; wristCm: number } | null {
    const rig = this.real
    if (!rig) return null
    const L = this.landmarks
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
    // The model point that stands for a landmark (the same choice as the rest pose in loadRealistic).
    const at = (lm: number): THREE.Vector3 => {
      if (lm === 0) return wp(rig.bones[1])
      const next = REAL_MAP.findIndex(([, f]) => f === lm)
      if (next >= 0) return wp(rig.bones[next])
      const to = REAL_MAP.findIndex(([, , t]) => t === lm)
      const end = rig.bones[to].children.find((c) => (c as THREE.Bone).isBone)
      return wp(end ?? rig.bones[to])
    }
    const deg = (a: THREE.Vector3, b: THREE.Vector3) => THREE.MathUtils.radToDeg(a.angleTo(b))
    const bones = REAL_MAP.map(([re, f, t], i) => {
      // As the solver sees it: the forearm end against elbow → wrist, a metacarpal from its own pivot.
      const from = REAL_BASES.has(i) ? wp(rig.bones[i]) : null
      const model = i === 0 ? new THREE.Vector3().subVectors(wp(rig.bones[1]), wp(rig.bones[0]))
        : new THREE.Vector3().subVectors(at(t), from ?? at(f))
      const target = i === 0 ? new THREE.Vector3().subVectors(L[0], this.elbow)
        : new THREE.Vector3().subVectors(L[t], from ?? L[f])
      return { name: re.source.replace(/^\^/, '').split(/[.\\]/)[0], errDeg: deg(model, target) }
    })
    const normal = (p0: THREE.Vector3, p5: THREE.Vector3, p9: THREE.Vector3, p17: THREE.Vector3) =>
      new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(p9, p0), new THREE.Vector3().subVectors(p5, p17))
    const palmDeg = deg(normal(at(0), at(5), at(9), at(17)), normal(L[0], L[5], L[9], L[17]))
    return { bones, palmDeg, wristCm: wp(rig.bones[1]).distanceTo(L[0]) }
  }

  get palm(): THREE.Vector3 {
    const L = this.landmarks
    return new THREE.Vector3().add(L[0]).add(L[5]).add(L[9]).add(L[17]).multiplyScalar(0.25)
  }

  /**
   * Between the thumb and index fingertips. For the realistic hand, its own fingertips as drawn: the
   * scanned fingers keep their own lengths, so the tracked tips can sit a centimetre or two off them,
   * and a held date then floated under the thumb instead of between the fingers.
   */
  get pinchPoint(): THREE.Vector3 {
    const rig = this.real
    if (rig && this.visible) {
      const tip = (i: number) => {
        const end = rig.bones[i].children.find((c) => (c as THREE.Bone).isBone) ?? rig.bones[i]
        return end.getWorldPosition(new THREE.Vector3())
      }
      return tip(5).add(tip(9)).multiplyScalar(0.5)
    }
    return this.landmarks[4].clone().add(this.landmarks[8]).multiplyScalar(0.5)
  }

  /** Where a fist closes: 3.5 cm out of the palm, as in the Unreal hand. */
  get graspPoint(): THREE.Vector3 {
    return this.palm.addScaledVector(this.dorsal, -3.5)
  }
}
