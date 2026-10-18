/**
 * Realistic hands: the WebXR generic-hand meshes (MIT, @webxr-input-profiles/assets) driven by
 * MediaPipe's 21 landmarks per hand. The 25 WebXR joints follow the WebXR convention three.js uses
 * for real hand tracking: each bone's -Z points along the finger toward the tip and +Y out of the
 * back of the hand, positions in metres in the hand root's space.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EYES, ue } from './space'
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

const SKIN = new THREE.Color().setRGB(0.62, 0.42, 0.32, THREE.SRGBColorSpace)
/** How fast the shown hand catches up with the tracked one (per second), and the jump that is shown at once. */
const FOLLOW_RATE = 18
const FOLLOW_SNAP_CM = 45

export class RiggedHand {
  readonly root = new THREE.Group()
  private bones: THREE.Bone[] = []
  private material!: THREE.MeshStandardMaterial
  /** Joint positions this frame (three.js cm, world space), in MediaPipe landmark order. */
  readonly landmarks: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3())
  /** Where the tracker says the landmarks are; the shown hand eases toward them every rendered frame. */
  private target: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3())
  private snap = true
  readonly dorsal = new THREE.Vector3(0, 1, 0)
  visible = false

  constructor(readonly side: Side) {
    this.root.scale.setScalar(100) // the asset is in metres, the scene in centimetres
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url)
    const armature = gltf.scene.children[0]
    this.root.add(armature)
    const mesh = armature.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh
    mesh.frustumCulled = false
    mesh.castShadow = true
    this.material = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0, emissive: new THREE.Color(0x3bb3bd), emissiveIntensity: 0 })
    mesh.material = this.material
    this.bones = JOINTS.map((n) => armature.getObjectByName(n) as THREE.Bone)
    this.root.visible = false
  }

  /** Glow while the camera sees a closed hand (0.6) or the hand holds something (1). */
  setGripFeedback(level: number) {
    if (this.material) this.material.emissiveIntensity = level * 0.18
  }

  /**
   * Places the hand: the wrist at the arm model's wrist, the fingers from the hand landmarks, or an
   * open hand along the forearm when the fingers are not tracked.
   */
  update(arm: ArmSample, hand: HandSample | null, dt: number) {
    const wrist = EYES.clone().add(ue(...arm.wrist))
    if (hand?.tracked && hand.points.length === 21) {
      const o = hand.points[0]
      for (let i = 0; i < 21; i++) {
        const p = hand.points[i]
        this.target[i].copy(wrist).add(ue(p[0] - o[0], p[1] - o[1], p[2] - o[2]))
      }
    } else {
      this.openHandAlongForearm(arm, wrist)
    }
    // The camera gives ~30 updates a second and the screen draws 60+: ease between them so the hand
    // glides instead of stepping, and jump straight there when it reappears or truly moved far.
    const far = this.landmarks[0].distanceTo(this.target[0]) > FOLLOW_SNAP_CM
    const k = this.snap || far ? 1 : 1 - Math.exp(-dt * FOLLOW_RATE)
    for (let i = 0; i < 21; i++) this.landmarks[i].lerp(this.target[i], k)
    this.snap = false
    this.pose()
  }

  /** No finger tracking: an open hand along the forearm, palm down (three.js axes: x right, y up, -z forward). */
  private openHandAlongForearm(arm: ArmSample, wrist: THREE.Vector3) {
    const f = ue(arm.wrist[0] - arm.elbow[0], arm.wrist[1] - arm.elbow[1], arm.wrist[2] - arm.elbow[2]).normalize()
    if (f.lengthSq() < 0.5) f.set(0, 0, -1)
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize()
    if (right.lengthSq() < 0.5) right.set(1, 0, 0)
    const up = new THREE.Vector3().crossVectors(right, f).normalize()
    const mirror = this.side === 'left' ? -1 : 1
    for (let i = 0; i < 21; i++) {
      const [x, y, z] = OPEN_RIGHT[i]
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
  }

  get palm(): THREE.Vector3 {
    const L = this.landmarks
    return new THREE.Vector3().add(L[0]).add(L[5]).add(L[9]).add(L[17]).multiplyScalar(0.25)
  }

  get pinchPoint(): THREE.Vector3 {
    return this.landmarks[4].clone().add(this.landmarks[8]).multiplyScalar(0.5)
  }

  /** Where a fist closes: 3.5 cm out of the palm, as in the Unreal hand. */
  get graspPoint(): THREE.Vector3 {
    return this.palm.addScaledVector(this.dorsal, -3.5)
  }
}
