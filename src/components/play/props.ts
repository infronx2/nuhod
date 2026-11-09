/**
 * The majlis objects the patient handles (NuhoudGrabbable, NuhoudLantern) and the task markers
 * (NuhoudTargetMarker): a lantern to hang, dates to serve or eat, the hook and the guest plate.
 * Physics is deliberately simple: a dropped object falls onto the table or the floor, rests, and
 * goes back to its place.
 */
import * as THREE from 'three'
import { EYES, ROOM, TABLE, lin, tablePoint } from './space'
import { lathe, mat } from './majlis'
import { fitHeight, whenModel } from './assets'

/** Fine lengthwise wrinkles for a date's skin, drawn once and shared by every date. */
let wrinkles: THREE.CanvasTexture | null = null
function dateWrinkles(): THREE.CanvasTexture {
  if (wrinkles) return wrinkles
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 90; i++) {
    const y = (i * 37) % 128, x = (i * 53) % 256, len = 40 + ((i * 29) % 90)
    g.strokeStyle = i % 3 ? 'rgba(20,20,20,0.55)' : 'rgba(235,235,235,0.35)'
    g.lineWidth = 1 + (i % 3)
    g.beginPath()
    g.moveTo(x, y)
    g.bezierCurveTo(x + len * 0.3, y + 4, x + len * 0.6, y - 4, x + len, y + 2)
    g.stroke()
  }
  wrinkles = new THREE.CanvasTexture(c)
  wrinkles.wrapS = wrinkles.wrapT = THREE.RepeatWrapping
  return wrinkles
}

let dateGeo: THREE.BufferGeometry | null = null
/**
 * A dried date: an egg-shaped body, slightly fuller at the stalk end, its skin pulled into soft
 * lengthwise folds and fine cross wrinkles (in the shape itself, so they catch the light).
 */
function dateGeometry(): THREE.BufferGeometry {
  if (dateGeo) return dateGeo
  const g = new THREE.SphereGeometry(1, 64, 40)
  const p = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const along = v.x // -1 (tip) .. 1 (stalk end): the long axis after scaling
    const a = Math.atan2(v.z, v.y)
    const folds = 0.045 * Math.sin(a * 6 + along * 1.7) + 0.025 * Math.sin(a * 11 - along * 3.1)
    const cross = 0.012 * Math.sin(along * 38 + a * 2) * (1 - Math.abs(along))
    const egg = 1 + 0.08 * along
    const r = egg * (1 + (folds + cross) * (1 - along * along * 0.6))
    v.y *= r
    v.z *= r
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  dateGeo = g
  return g
}

/** Makes a loaded model's opaque materials glow for the "you can pick this up" highlight. */
function glowModel(g: THREE.Object3D, register: (m: THREE.MeshStandardMaterial) => void, colour = 0xffd28a) {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      if (!mt.isMeshStandardMaterial || mt.transparent) continue
      mt.emissive = new THREE.Color(colour)
      mt.emissiveIntensity = 0
      register(mt)
    }
  })
}

export type Grip = 'pinch' | 'grasp'
export type GrabState = 'home' | 'held' | 'free' | 'placed' | 'returning' | 'gone'

const GRAVITY = -980 // cm/s²
const SCREEN_DEPTH_TOLERANCE = 2.5

/**
 * Distance as the patient judges it on a flat screen: depth along the line of sight counts 2.5
 * times less than across it (ANuhoudFirstPersonPawn::PerceivedDistance).
 */
export function perceived(a: THREE.Vector3, b: THREE.Vector3): number {
  const los = new THREE.Vector3().subVectors(b, EYES).normalize()
  const delta = new THREE.Vector3().subVectors(a, b)
  const along = delta.dot(los)
  const across = delta.addScaledVector(los, -along)
  return Math.sqrt(across.lengthSq() + (along / SCREEN_DEPTH_TOLERANCE) ** 2)
}

export class Grabbable {
  readonly object = new THREE.Group()
  state: GrabState = 'home'
  enabled = false
  private home = new THREE.Vector3()
  private homeQuat = new THREE.Quaternion()
  private velocity = new THREE.Vector3()
  private offset = new THREE.Vector3()
  private restTimer = 0
  private highlight = 0
  private glowMats: THREE.MeshStandardMaterial[] = []
  onReleased?: (g: Grabbable) => void

  constructor(readonly kind: 'date' | 'lantern' | 'finjan' | 'dallah', readonly grips: Grip[], readonly radius: number,
    readonly restHeight: number, readonly keepUpright = false) {}

  protected glowable(m: THREE.MeshStandardMaterial) {
    this.glowMats.push(m)
    return m
  }

  setHome(position: THREE.Vector3, quat = new THREE.Quaternion()) {
    this.home.copy(position)
    this.homeQuat.copy(quat)
    this.object.position.copy(position)
    this.object.quaternion.copy(quat)
    this.state = 'home'
  }

  get position() { return this.object.position }
  canBeGrabbed() { return this.enabled && (this.state === 'home' || this.state === 'free' || this.state === 'returning') }
  allowsGrip(g: Grip) { return this.grips.includes(g) }

  closestSurfacePoint(p: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3().subVectors(p, this.object.position)
    const len = d.length()
    return len <= this.radius ? p.clone() : this.object.position.clone().addScaledVector(d, this.radius / len)
  }

  beginGrab(gripPoint: THREE.Vector3) {
    this.state = 'held'
    // Keep where the hand took it, but never let it float far from the fingers.
    this.offset.subVectors(this.object.position, gripPoint).clampLength(0, this.radius * 0.6)
    this.velocity.set(0, 0, 0)
  }

  updateHeld(gripPoint: THREE.Vector3, handQuat: THREE.Quaternion | null, dt: number) {
    const target = gripPoint.clone().add(this.offset)
    this.object.position.lerp(target, Math.min(1, dt * 25))
    if (!this.keepUpright && handQuat) this.object.quaternion.slerp(handQuat, Math.min(1, dt * 10))
  }

  release(velocity: THREE.Vector3) {
    if (this.state !== 'held') return
    this.state = 'free'
    this.velocity.copy(velocity).clampLength(0, 150)
    this.restTimer = 0
    this.onReleased?.(this)
  }

  placeAt(position: THREE.Vector3) {
    this.state = 'placed'
    this.object.position.copy(position)
    if (this.keepUpright) this.object.quaternion.copy(this.homeQuat)
  }

  returnHome() { this.state = 'returning' }

  /** Eaten: shrinks away, comes back to the bowl a moment later. */
  eat() {
    this.state = 'gone'
    this.restTimer = 0
  }

  requestHighlight() { this.highlight = 1 }

  update(dt: number) {
    if (this.state === 'free') {
      this.velocity.y += GRAVITY * dt
      this.object.position.addScaledVector(this.velocity, dt)
      const p = this.object.position
      const overTable = Math.hypot(p.x - 0, p.z - -TABLE.centerX) < TABLE.diameter / 2
      const floorY = (overTable ? TABLE.top : 2) + this.restHeight
      if (p.y < floorY) {
        p.y = floorY
        this.velocity.multiplyScalar(0.3).setY(0)
      }
      // Stay inside the room.
      p.x = THREE.MathUtils.clamp(p.x, -ROOM.halfY + 10, ROOM.halfY - 10)
      this.restTimer += dt
      if (this.restTimer > 1.6) this.state = 'returning'
    } else if (this.state === 'returning') {
      this.object.position.lerp(this.home, Math.min(1, dt * 4))
      this.object.quaternion.slerp(this.homeQuat, Math.min(1, dt * 4))
      if (this.object.position.distanceTo(this.home) < 0.3) this.setHome(this.home, this.homeQuat)
    } else if (this.state === 'gone') {
      this.restTimer += dt
      this.object.scale.setScalar(Math.max(0.001, 1 - this.restTimer * 4))
      if (this.restTimer > 2) {
        this.object.scale.setScalar(1)
        this.setHome(this.home, this.homeQuat)
      }
    }
    // Glow whatever the hand could pick up right now.
    this.highlight = Math.max(0, this.highlight - dt * 3)
    for (const m of this.glowMats) m.emissiveIntensity = 0.25 * this.highlight + (this.state === 'held' ? 0.12 : 0)
  }
}

export class DateFruit extends Grabbable {
  constructor() {
    super('date', ['pinch', 'grasp'], 1.6, 0.8)
    // A ripe khalas date: dark amber, glossy, finely wrinkled along its length.
    const skin = new THREE.MeshPhysicalMaterial({
      color: lin(0.22, 0.075, 0.022),
      roughness: 0.42,
      clearcoat: 0.55,
      clearcoatRoughness: 0.35,
      bumpMap: dateWrinkles(),
      bumpScale: 0.6,
      emissive: new THREE.Color(0xffc070),
      emissiveIntensity: 0,
    })
    this.glowable(skin)
    const fruit = new THREE.Mesh(dateGeometry(), skin)
    fruit.scale.set(1.4, 0.82, 0.78)
    fruit.rotation.y = Math.random() * Math.PI * 2
    fruit.rotation.x = (Math.random() - 0.5) * 0.4
    fruit.castShadow = true
    this.object.add(fruit)
    // The pale cap where the date hung from its stalk.
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), mat(lin(0.45, 0.3, 0.14), 0, 0.8))
    cap.position.x = 1.39
    cap.rotation.y = Math.PI / 2
    this.object.add(cap)
  }
}

export class Finjan extends Grabbable {
  constructor() {
    super('finjan', ['pinch', 'grasp'], 3, 0)
    // An Omani finjan: glazed white porcelain, a gold rim and foot band, half filled with gahwa.
    const porcelain = new THREE.MeshPhysicalMaterial({
      color: lin(0.9, 0.88, 0.83), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06,
      emissive: new THREE.Color(0xffd28a), emissiveIntensity: 0,
    })
    this.glowable(porcelain)
    const gold = new THREE.MeshPhysicalMaterial({ color: lin(0.83, 0.6, 0.25), metalness: 1, roughness: 0.22 })
    const cup = lathe([[0, 0], [1.7, 0], [1.85, 0.15], [1.9, 0.45], [2.25, 0.6], [2.55, 1.6], [2.8, 2.9], [3.0, 3.75], [2.86, 3.8],
      [2.66, 2.95], [2.42, 1.75], [2.1, 0.85], [0, 0.8]], porcelain, 48)
    this.object.add(cup)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.93, 0.07, 8, 48), gold)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 3.78
    this.object.add(rim)
    const foot = new THREE.Mesh(new THREE.TorusGeometry(1.88, 0.06, 8, 40), gold)
    foot.rotation.x = Math.PI / 2
    foot.position.y = 0.3
    this.object.add(foot)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.86, 2.84, 0.18, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: lin(0.08, 0.32, 0.22), roughness: 0.2, clearcoat: 1 }))
    band.position.y = 3.25
    this.object.add(band)
    const gahwa = new THREE.Mesh(new THREE.CircleGeometry(2.55, 40), new THREE.MeshPhysicalMaterial({ color: lin(0.42, 0.27, 0.1), roughness: 0.08, clearcoat: 1 }))
    gahwa.rotation.x = -Math.PI / 2
    gahwa.position.y = 2.2
    this.object.add(gahwa)
  }
}

export class Dallah extends Grabbable {
  constructor() {
    super('dallah', ['grasp'], 7, 0)
    const brass = this.glowable(new THREE.MeshPhysicalMaterial({
      color: lin(0.72, 0.52, 0.24), metalness: 1, roughness: 0.3, clearcoat: 0.3,
      emissive: new THREE.Color(0xffd28a), emissiveIntensity: 0,
    }))
    const body = new THREE.Group()
    body.add(lathe([[0, 0], [6.5, 0], [7, 0.8], [7.2, 4], [6.2, 8], [3.2, 11], [2.8, 13], [3.8, 15.5], [4.6, 16], [3.6, 17.5],
      [2.2, 19.5], [1.2, 21], [0.8, 23], [1.3, 24], [0, 25]], brass, 48))
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 14, 16), brass)
    spout.position.set(0, 11, -6.5)
    spout.rotation.x = -0.75
    body.add(spout)
    const handle = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.5, 10, 24, Math.PI), brass)
    handle.position.set(0, 10, 5.5)
    handle.rotation.y = Math.PI / 2
    handle.rotation.z = -Math.PI / 2
    body.add(handle)
    this.object.add(body)
    // The scanned brass dallah (Sketchfab, CC BY) replaces the turned one when it is present;
    // its spout faces -z like the built-in one, so a pour still tips the right way.
    whenModel('dallah', (g) => {
      glowModel(g, (m) => this.glowable(m))
      const holder = new THREE.Group()
      holder.add(fitHeight(g, 25))
      body.clear()
      body.add(holder)
    })
  }
}

export class Lantern extends Grabbable {
  private light: THREE.PointLight
  private glass: THREE.MeshStandardMaterial
  private flame: THREE.MeshStandardMaterial
  private glow = 0
  lit = false
  touchProgress = 0
  allowTouchLighting = false
  nearestPalm = Infinity
  onTouchLit?: (l: Lantern) => void
  decoration = false
  private hangTarget = new THREE.Vector3()
  private bob = Math.random() * 6.28
  /** The ring on top, where it hangs from (Unreal GrabAnchorLocal, relative to the body centre). */
  static readonly ANCHOR_Y = 10.3 - 1.8
  static readonly TOUCH_RADIUS = 16
  private chain?: THREE.Mesh

  constructor() {
    super('lantern', ['grasp'], 6.5, 9.8, true)
    const brass = this.glowable(mat(lin(0.62, 0.46, 0.24), 1, 0.4, new THREE.Color(0xffd28a)))
    this.glass = mat(lin(0.9, 0.75, 0.45), 0, 0.12, new THREE.Color(1, 0.55, 0.18))
    this.glass.transparent = true
    this.glass.opacity = 0.85
    this.flame = mat(lin(1, 0.7, 0.3), 0, 0.5, new THREE.Color(1, 0.55, 0.18))
    const visual = new THREE.Group()
    visual.position.y = -1.8
    visual.add(lathe([[0, -8], [5, -8], [5.3, -7.3], [4.9, -6.4], [4.5, -6], [0, -6]], brass, 28))
    visual.add(lathe([[4.3, -6], [4.7, -3], [4.8, 0], [4.6, 2.5], [4.2, 3.4]], this.glass, 28))
    visual.add(lathe([[0, 3.2], [4.7, 3.2], [5.1, 3.8], [4.4, 4.6], [3, 6.2], [1.6, 7.4], [1.1, 7.8], [1.1, 8.6], [0.6, 9.2], [0, 9.3]], brass, 28))
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9.5, 6), brass)
      bar.position.set(Math.cos(a) * 4.85, -1.4, Math.sin(a) * 4.85)
      visual.add(bar)
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.28, 6, 16), brass)
    ring.position.y = 10.3
    visual.add(ring)
    const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.flame)
    flame.position.y = -2
    flame.scale.set(1, 1.7, 1)
    visual.add(flame)
    this.light = new THREE.PointLight(0xffad61, 0, 350, 2)
    this.light.position.y = -1
    visual.add(this.light)
    this.object.add(visual)
    this.applyGlow(0, 0)

    // The Poly Haven hurricane lantern (CC0) replaces the turned one, at the same size: its base on the
    // table 9.8 cm below the centre and its handle at the hanging anchor. The flame and its light stay.
    whenModel('Lantern_01', (g) => {
      g.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const mt = m.material as THREE.MeshPhysicalMaterial
        // Transmission costs a second render pass on phones; plain transparency reads the same at this size.
        if (mt.transmission > 0 || mt.transparent || /glass/i.test(mt.name) || /glass/i.test(m.name)) {
          const glass = new THREE.MeshStandardMaterial({ color: lin(0.95, 0.85, 0.7), roughness: 0.05, metalness: 0,
            transparent: true, opacity: 0.32, emissive: new THREE.Color(1, 0.55, 0.18), emissiveIntensity: 0, depthWrite: false })
          m.material = glass
          this.modelGlass.push(glass)
          m.castShadow = false
        }
      })
      glowModel(g, (m) => this.glowable(m))
      const holder = new THREE.Group()
      holder.add(fitHeight(g, 19.4))
      holder.position.y = -8
      for (const c of [...visual.children]) if (c !== flame && c !== this.light) visual.remove(c)
      visual.add(holder)
      this.applyGlow(this.glow, 0)
    })
  }

  private modelGlass: THREE.MeshStandardMaterial[] = []

  private applyGlow(lit: number, proximity: number) {
    this.glass.emissiveIntensity = 0.04 + lit * 2.2 + proximity * 0.5
    for (const g of this.modelGlass) g.emissiveIntensity = 0.02 + lit * 0.45 + proximity * 0.3
    this.flame.emissiveIntensity = 0.3 + lit * 6
    // Softer while in the hand: a point light a few centimetres from the skin would wash the fingers out.
    this.light.intensity = lit * (this.state === 'held' ? 320 : 1600)
  }

  /** Hung on a ceiling slot as decoration (drifts there unless instant), lit, with a chain up to the ceiling. */
  hangAsDecoration(slot: THREE.Vector3, instant: boolean) {
    this.state = 'placed'
    this.enabled = false
    this.decoration = true
    this.lit = true
    this.hangTarget.copy(slot)
    this.object.quaternion.identity()
    if (instant) {
      this.glow = 1
      this.object.position.copy(slot)
      this.addChain()
    }
  }

  private addChain() {
    if (this.chain) return
    const ringTop = this.object.position.y + Lantern.ANCHOR_Y + 1
    const length = ROOM.ceiling - ringTop
    if (length <= 1) return
    this.chain = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, length, 6), mat(lin(0.3, 0.22, 0.12), 1, 0.5))
    this.chain.position.y = Lantern.ANCHOR_Y + 1 + length / 2
    this.object.add(this.chain)
  }

  lightUp() { this.lit = true }

  update(dt: number) {
    super.update(dt)
    this.bob += dt
    let proximity = 0
    if (this.decoration) {
      if (!this.chain) {
        this.object.position.lerp(this.hangTarget, Math.min(1, dt * 2.5))
        if (this.object.position.distanceTo(this.hangTarget) < 1) {
          this.object.position.copy(this.hangTarget)
          this.addChain()
        }
      }
      this.object.rotation.z = Math.sin(this.bob * 0.7) * 0.026
    } else if (!this.lit && this.allowTouchLighting && this.canBeGrabbed()) {
      proximity = THREE.MathUtils.clamp(1 - this.nearestPalm / (Lantern.TOUCH_RADIUS * 2.5), 0, 1)
      if (this.nearestPalm < Lantern.TOUCH_RADIUS) this.touchProgress += dt / 2.5
      else this.touchProgress = Math.max(0, this.touchProgress - dt * 0.15)
      if (this.touchProgress >= 1) {
        this.lit = true
        this.onTouchLit?.(this)
      }
    }
    const target = this.lit ? 1 : this.state === 'held' ? 0.15 : this.touchProgress
    this.glow += (target - this.glow) * Math.min(1, dt * 8)
    this.applyGlow(this.glow, proximity)
  }

  /** The hanging ring in world space. */
  get anchor(): THREE.Vector3 {
    return this.object.localToWorld(new THREE.Vector3(0, Lantern.ANCHOR_Y, 0))
  }
}

/** The glowing hook (lantern task) or guest plate (serve task), with a fill ring for holding still. */
export class TargetMarker {
  readonly object = new THREE.Group()
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x9ff3f7, transparent: true, opacity: 0.85 })
  private progressMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  private progress?: THREE.Mesh
  private celebrateT = -1
  private t = 0
  readonly kind: 'hook' | 'plate'

  constructor(kind: 'hook' | 'plate', at: THREE.Vector3) {
    this.kind = kind
    this.object.position.copy(at)
    if (kind === 'hook') {
      const brass = mat(lin(0.55, 0.42, 0.22), 1, 0.4)
      const length = ROOM.ceiling - at.y
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, length, 8), brass)
      rod.position.y = length / 2 + 3
      this.object.add(rod)
      const hook = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.35, 8, 16, Math.PI * 1.4), brass)
      hook.position.y = 1.5
      hook.rotation.z = Math.PI * 0.8
      this.object.add(hook)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.45, 8, 48), this.ringMat)
      ring.rotation.x = Math.PI / 2
      this.object.add(ring)
    } else {
      const plate = lathe([[0, 0], [5, 0], [6.5, 0.6], [8, 1.2], [8.3, 1.4], [8, 1.5], [6, 0.9], [0, 0.8]], mat(lin(0.88, 0.86, 0.8), 0, 0.3), 32)
      this.object.add(plate)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.4, 8, 48), this.ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.6
      this.object.add(ring)
    }
  }

  /** The top of the guest plate (where a served date rests). */
  get plateTop(): THREE.Vector3 {
    return this.object.position.clone().add(new THREE.Vector3(0, 1.2, 0))
  }

  setProgress(f: number) {
    const k = THREE.MathUtils.clamp(f, 0, 1)
    if (this.progress) {
      this.object.remove(this.progress)
      this.progress.geometry.dispose()
      this.progress = undefined
    }
    if (k <= 0.01) return
    const r = this.kind === 'hook' ? 8 : 10
    this.progress = new THREE.Mesh(new THREE.TorusGeometry(r, 0.9, 8, 48, Math.PI * 2 * k), this.progressMat)
    this.progress.rotation.x = Math.PI / 2
    this.progress.position.y = this.kind === 'hook' ? 0 : 0.7
    this.object.add(this.progress)
  }

  celebrate() { this.celebrateT = 0 }

  update(dt: number) {
    this.t += dt
    this.ringMat.opacity = 0.55 + 0.3 * Math.sin(this.t * 4)
    if (this.celebrateT >= 0) {
      this.celebrateT += dt
      const s = 1 + this.celebrateT * 1.5
      this.object.scale.setScalar(s)
      this.ringMat.opacity = Math.max(0, 0.9 - this.celebrateT * 1.2)
    }
  }
}

/** Table spots, from NuhoudMajlis.cpp. */
export function lanternSpot(right: boolean) { return tablePoint(6, right ? 30 : -30) }
export function plateSpot(right: boolean) { return tablePoint(8, right ? 33 : -33) }
