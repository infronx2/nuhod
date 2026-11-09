/**
 * The web majlis session: renders the room from the patient's seat, tracks the camera every frame,
 * drives the hands and the task director, and keeps the session record.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { loadEnvironment, preloadModels, setMaxAnisotropy } from './assets'
import { buildMajlis } from './majlis'
import { RiggedHand } from './hands'
import { HandInput } from './input'
import { SessionRecord } from './session'
import { TaskDirector, type Plan } from './tasks'
import { Tracker, type ArmSample, type Side, type TrackFrame } from './tracking'
import { Voice } from './voice'
import { SimPatient } from './sim'
import { EYES, ue } from './space'
import { Calibration } from './calibration'
import { PostureWatch, type Compensation } from './posture'

/** ?debug in the address exposes tracking values on window.__nuhoud. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
/** ?handtest moves the tracked arms forward over the table (finger shape unchanged), to check the hand mesh. */
const HANDTEST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('handtest')
/** ?sim replaces the camera with a scripted patient (testing without a camera). */
const SIM = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sim')
const HANDTEST_OPEN = HANDTEST && new URLSearchParams(window.location.search).get('handtest') === 'open'
const HANDCAM = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('handcam')
/** ?inspect: the camera picture with what Google's models saw drawn over it, and running counts on window.__inspect. */
const INSPECT = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('inspect')
/** ?mirror: flip each picture before tracking (a recording saved mirrored, as many selfie videos are). */
const MIRROR = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mirror')
/** ?nocalib skips the per-hand calibration at the start (testing). */
const NOCALIB = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nocalib')
/** Shortest gap between two spoken posture reminders (s). */
const POSTURE_REMINDER_GAP_S = 20
const POSTURE_REMINDER: Record<Compensation, string> = {
  lean: 'خلّ ظهرك ثابت، ومدّ ذراعك براحة',
  hike: 'نزّل كتفك وارخه، وارفع ذراعك براحة',
}

const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]]
const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]]
/** ?quality=ultra|high|low pins the render quality (otherwise it adapts to the device's frame rate). */
const FORCED_QUALITY = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('quality') : null

/**
 * Render quality. ultra: ambient occlusion + glow + 4x MSAA (iPad Pro, recent iPhones, desktops).
 * high: glow + MSAA. low: the plain renderer. The game starts at the best level the device suggests and
 * steps down once if the frame rate stays low, so a slower phone keeps the tracking smooth.
 */
type Quality = 'ultra' | 'high' | 'low'
const QUALITY_ORDER: Quality[] = ['ultra', 'high', 'low']
/** Render frames per second below which the game steps down a level (measured over 3 s). */
const STEP_DOWN_FPS = 42

export interface HudState {
  instruction: string
  done: number
  goal: number
  score: number
  body: boolean
  hands: { right: boolean; left: boolean }
  fps: number
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private hands: Record<Side, RiggedHand> = { right: new RiggedHand('right'), left: new RiggedHand('left') }
  private input: HandInput
  readonly record = new SessionRecord()
  private director: TaskDirector
  readonly voice = new Voice()
  private tracker: Tracker | null = null
  private sim: SimPatient | null = null
  private arms: Partial<Record<Side, ArmSample>> = {}
  private lastFrame: TrackFrame | null = null
  private raf = 0
  private last = 0
  private lastVideoTime = -1
  private frames = 0
  private fpsT = 0
  private fps = 0
  private running = false
  private resizeObserver: ResizeObserver
  private quality: Quality
  private composer: EffectComposer | null = null
  private gtao: GTAOPass | null = null
  private renderFrames = 0
  private renderFpsT = 0
  private qualityChecks = 0
  private mirrorCanvas: HTMLCanvasElement | null = null
  private inspectCanvas: HTMLCanvasElement | null = null
  /** Running counts for ?inspect: frames tracked, and how often the body and each hand were found. */
  readonly inspect = { frames: 0, body: 0, right: 0, left: 0, both: 0 }
  /** The per-hand calibration while it runs (before the first task). */
  private calibration: Calibration | null = null
  readonly posture = new PostureWatch()
  private lastReminder = -1e9
  /** A posture reminder shown for a few seconds over the task instruction. */
  private reminder = ''
  private reminderTime = 0

  constructor(private container: HTMLElement, private video: HTMLVideoElement, private plan: Plan,
    private onHud: (s: HudState) => void, private onFinish: (reason: 'goal') => void) {
    const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4
    this.quality = (QUALITY_ORDER as string[]).includes(FORCED_QUALITY ?? '') ? FORCED_QUALITY as Quality : lowEnd ? 'high' : 'ultra'
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowEnd ? 1.25 : 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy())
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x1d140d)
    // Soft room reflections right away; the real interior HDRI replaces them once it has loaded.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.35
    pmrem.dispose()
    buildMajlis(this.scene, lowEnd ? 'low' : 'high')

    // Seated first person, looking toward the table and the hooks above it.
    this.camera = new THREE.PerspectiveCamera(62, 1, 1, 2000)
    this.camera.position.copy(EYES)
    this.camera.lookAt(EYES.clone().add(ue(115, 0, -50)))
    this.scene.add(this.camera)

    for (const h of Object.values(this.hands)) this.scene.add(h.root, h.forearm)
    this.input = new HandInput(this.hands, () => this.director.grabbables(), {
      onGrab: (pinch, side) => this.record.recordGrab(pinch, side === 'right'),
      onGripSample: (c, p) => this.record.recordGrip(c, p),
    })
    this.input.active = { right: plan.limb !== 'left', left: plan.limb !== 'right' }
    this.director = new TaskDirector(this.scene, this.input, this.record, plan,
      { say: (e, i) => this.voice.say(e, i), finish: (r) => this.onFinish(r) }, () => this.arms)

    this.buildComposer()
    if (INSPECT) {
      const c = document.createElement('canvas')
      c.style.cssText = 'position:absolute;left:8px;top:64px;width:min(46vw,520px);height:auto;border-radius:12px;border:2px solid #7fd8de;z-index:5;pointer-events:none;background:#000'
      container.appendChild(c)
      this.inspectCanvas = c
      ;(window as unknown as { __inspect: unknown }).__inspect = this.inspect
    }
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  async load() {
    await Promise.all([
      // The realistic scanned hand; the WebXR hand if it cannot load.
      this.hands.right.loadRealistic('/play/assets/models/hand_realistic.glb').catch((e) => {
        console.warn('[play] realistic hand not loaded, using the WebXR hand', e)
        return this.hands.right.load('/play/hands/right.glb')
      }),
      this.hands.left.loadRealistic('/play/assets/models/hand_realistic.glb').catch(() => this.hands.left.load('/play/hands/left.glb')),
      preloadModels(),
      loadEnvironment(this.renderer, this.scene, 0.6),
    ])
    if (SIM) this.sim = new SimPatient()
    else this.tracker = await Tracker.create('/play')
  }

  /** The effect chain for the current quality (none at 'low'): AO, glow on the lit lantern and windows, MSAA. */
  private buildComposer() {
    this.composer?.dispose()
    this.composer = null
    this.gtao?.dispose()
    this.gtao = null
    if (this.quality === 'low') return
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    const composer = new EffectComposer(this.renderer, target)
    composer.addPass(new RenderPass(this.scene, this.camera))
    if (this.quality === 'ultra') {
      // The room is in centimetres: a 14 cm radius darkens the contact between hands, cups and the table.
      const gtao = new GTAOPass(this.scene, this.camera, 1, 1)
      gtao.blendIntensity = 0.75
      gtao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.5, thickness: 6, scale: 1, samples: 12 })
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 })
      composer.addPass(gtao)
      this.gtao = gtao
    }
    // Only real light sources bloom: the lit lantern's glass and flame, and the sunlit windows.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.45, 0.92))
    composer.addPass(new OutputPass())
    this.composer = composer
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.composer?.setPixelRatio(this.renderer.getPixelRatio())
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h
    // Keep the table and the hooks in view in portrait too.
    this.camera.fov = w / h < 1 ? 82 : 62
    this.camera.updateProjectionMatrix()
  }

  /** Steps the quality down a level (at most twice) when the screen keeps drawing too few frames. */
  private adaptQuality(t: number) {
    this.renderFrames++
    if (!this.renderFpsT) this.renderFpsT = t
    if (t - this.renderFpsT < 3000) return
    const fps = (this.renderFrames * 1000) / (t - this.renderFpsT)
    this.renderFrames = 0
    this.renderFpsT = t
    if (FORCED_QUALITY || this.qualityChecks++ < 1) return // the first window includes loading
    const i = QUALITY_ORDER.indexOf(this.quality)
    if (fps < STEP_DOWN_FPS && i < QUALITY_ORDER.length - 1) {
      this.quality = QUALITY_ORDER[i + 1]
      console.info(`[play] ${Math.round(fps)} fps, render quality now ${this.quality}`)
      this.buildComposer()
      this.resize()
    }
  }

  /** Tracking only (for the "can the camera see you" step), without the tasks. */
  startPreview() {
    this.running = false
    this.raf = requestAnimationFrame(this.loop)
  }

  start() {
    this.running = true
    const sides = (['right', 'left'] as Side[]).filter((s) => this.input.active[s])
    if (NOCALIB || !sides.length) {
      this.director.start()
      return
    }
    this.calibration = new Calibration(sides)
    this.calibration.onStep = (text) => this.voice.speak(text, true)
  }

  private calibrationInput = {
    visible: (s: Side) => this.input.isVisible(s),
    closure: (s: Side) => this.input.closure(s),
    pinchCm: (s: Side) => this.input.pinchCm(s),
  }

  /** The calibration finished: fit each hand's thresholds and display, then the first task. */
  private finishCalibration(c: Calibration) {
    for (const [side, range] of Object.entries(c.results) as Array<[Side, NonNullable<Calibration['results'][Side]>]>) {
      this.input.calibrate(side, range)
      this.hands[side].setBestFist(range.fist)
      console.info(`[play] ${side} hand range: open ${range.open.toFixed(2)}, fist ${range.fist.toFixed(2)}, pinch ${range.pinchCm.toFixed(1)} cm`)
    }
    this.calibration = null
    this.director.start()
  }

  /** A compensation started during a task: count it, and remind gently now and then. */
  private onCompensation(kind: Compensation, now: number) {
    this.record.compensations++
    if (now - this.lastReminder < POSTURE_REMINDER_GAP_S) return
    this.lastReminder = now
    this.reminder = POSTURE_REMINDER[kind]
    this.reminderTime = 4
    this.voice.speak(this.reminder)
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0)
    this.last = t
    const now = t / 1000

    const camFrame = this.tracker && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime
    if (camFrame || this.sim) {
      this.lastVideoTime = this.video.currentTime
      const f = this.sim ? this.sim.frame(now, this.director.simTargets()) : this.tracker!.process(MIRROR ? this.mirrored() : this.video, t)
      this.lastFrame = f
      if (this.inspectCanvas && !this.sim) this.drawInspect(f)
      this.frames++
      for (const side of ['right', 'left'] as Side[]) {
        let arm = f.arms[side]
        if (arm && HANDTEST) {
          const o: [number, number, number] = [52, side === 'right' ? -8 : 8, 12]
          const move = (v: [number, number, number]) => [v[0] + o[0], v[1] + o[1], v[2] + o[2]] as [number, number, number]
          arm = { ...arm, tracked: true, wrist: move(arm.wrist), elbow: move(arm.elbow) }
          // Open-hand test: a forearm reaching straight forward over the table.
          if (HANDTEST_OPEN) arm = { ...arm, wrist: [40, side === 'right' ? 12 : -12, -32], elbow: [14, side === 'right' ? 18 : -18, -40] }
        }
        if (arm?.tracked) this.arms[side] = arm
        this.input.feed(side, arm, HANDTEST_OPEN ? { ...f.hands[side], tracked: false } : f.hands[side], now)
      }
      // Posture: the resting shape while calibrating, the compensation check during a task.
      if (this.calibration) this.posture.observeRest(f)
      else if (this.running && this.director.active && !this.sim) {
        const kind = this.posture.update(f, this.director.taskSide, dt)
        if (kind) this.onCompensation(kind, now)
      }
      if (this.running) {
        // The reaching arm's shoulder elevation and elbow angle, for the doctor's charts.
        const active = (['right', 'left'] as Side[]).filter((s) => this.input.active[s] && f.arms[s]?.tracked)
        if (active.length) {
          const best = active.map((s) => f.arms[s]!).sort((a, b) => b.shoulderElevation - a.shoulderElevation)[0]
          this.record.recordAngle(best.shoulderElevation, best.elbowAngle)
        }
      }
    }
    if (t - this.fpsT > 1000) {
      this.fps = this.frames
      this.frames = 0
      this.fpsT = t
    }
    this.input.update(now, dt)
    if (this.calibration) {
      this.calibration.update(dt, this.calibrationInput)
      if (this.calibration.done) this.finishCalibration(this.calibration)
    } else if (this.running) this.director.update(dt)
    this.reminderTime = Math.max(0, this.reminderTime - dt)
    if (HANDCAM && this.hands.right.visible) {
      // ?handcam: a close camera on the right hand, to check the fingers and the wrist.
      const p = this.hands.right.palm
      this.camera.position.copy(p).add(new THREE.Vector3(-14, 16, 22))
      this.camera.lookAt(p)
    }
    if (this.composer) this.composer.render(dt)
    else this.renderer.render(this.scene, this.camera)
    this.adaptQuality(t)

    const f = this.lastFrame
    if (DEBUG) {
      // Every rendered frame's palm positions, for measuring jitter offline.
      const w = window as unknown as { __trace?: number[][] }
      w.__trace ??= []
      if (w.__trace.length < 6000) w.__trace.push([t, ...this.hands.right.palm.toArray(), ...this.hands.left.palm.toArray(), camFrame ? 1 : 0, this.hands.right.visible ? 1 : 0, f?.hands.right.tracked ? 1 : 0, f?.arms.right?.tracked ? 1 : 0])
      ;(window as unknown as { __game: unknown }).__game = { hands: this.hands }
      ;(window as unknown as { __nuhoud: unknown }).__nuhoud = {
        body: f?.body,
        arms: Object.fromEntries((['right', 'left'] as Side[]).map((s) => [s, f?.arms[s] && { tracked: f.arms[s]!.tracked, wrist: f.arms[s]!.wrist.map(Math.round), elev: Math.round(f.arms[s]!.shoulderElevation) }])),
        hands: { right: f?.hands.right.tracked, left: f?.hands.left.tracked },
        visible: { right: this.input.isVisible('right'), left: this.input.isVisible('left') },
        palm: (['right', 'left'] as Side[]).map((s) => this.hands[s].palm.toArray().map(Math.round)),
        grip: { right: this.input.describe('right'), left: this.input.describe('left') },
        task: this.running ? this.director.task : null,
        calibrating: !!this.calibration,
        posture: { ...this.posture.last, compensations: this.record.compensations },
      }
    }
    this.onHud({
      instruction: !this.running ? ''
        : this.calibration ? this.calibration.instruction(this.calibrationInput)
          : this.reminderTime > 0 ? this.reminder : this.director.instruction(),
      done: this.record.reps,
      goal: this.plan.dailyTasks,
      score: this.record.score,
      body: !!f?.body,
      hands: { right: this.input.isVisible('right'), left: this.input.isVisible('left') },
      fps: this.fps,
    })
  }

  /** The current video picture flipped left to right (?mirror). */
  private mirrored(): HTMLCanvasElement {
    const v = this.video
    const c = (this.mirrorCanvas ??= document.createElement('canvas'))
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth
      c.height = v.videoHeight
    }
    const g = c.getContext('2d')!
    g.setTransform(-1, 0, 0, 1, c.width, 0)
    g.drawImage(v, 0, 0)
    return c
  }

  /**
   * ?inspect: the picture the models were given, with the body (teal) and each hand (right gold, left
   * blue) as Google's models found them, and what the game made of it: grip, pinch, arm angles.
   */
  private drawInspect(f: TrackFrame) {
    const c = this.inspectCanvas!
    const src: CanvasImageSource = MIRROR && this.mirrorCanvas ? this.mirrorCanvas : this.video
    const w = 520, h = Math.round((520 * (this.video.videoHeight || 9)) / (this.video.videoWidth || 16))
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    const g = c.getContext('2d')!
    g.drawImage(src, 0, 0, w, h)
    const line = (pts: Array<{ x: number; y: number }>, links: number[][], colour: string, width: number) => {
      g.strokeStyle = colour
      g.lineWidth = width
      for (const [a, b] of links) {
        if (!pts[a] || !pts[b]) continue
        g.beginPath(); g.moveTo(pts[a].x * w, pts[a].y * h); g.lineTo(pts[b].x * w, pts[b].y * h); g.stroke()
      }
      g.fillStyle = colour
      for (const p of pts) { g.beginPath(); g.arc(p.x * w, p.y * h, width + 1, 0, 7); g.fill() }
    }
    if (f.image?.pose) line(f.image.pose, POSE_LINKS, '#7fd8de', 3)
    if (f.image?.hands.right) line(f.image.hands.right, HAND_LINKS, '#ffcc4d', 2)
    if (f.image?.hands.left) line(f.image.hands.left, HAND_LINKS, '#58a6ff', 2)
    const s = this.inspect
    s.frames++
    if (f.body) s.body++
    if (f.hands.right.tracked) s.right++
    if (f.hands.left.tracked) s.left++
    if (f.hands.right.tracked && f.hands.left.tracked) s.both++
    const pct = (n: number) => `${Math.round((100 * n) / s.frames)}%`
    const arm = (side: Side) => f.arms[side]?.tracked ? `${Math.round(f.arms[side]!.shoulderElevation)}° / ${Math.round(f.arms[side]!.elbowAngle)}°` : '—'
    const rows = [
      `body ${f.body ? 'yes' : 'NO'} (${pct(s.body)})  ·  frames ${s.frames}`,
      `right hand ${f.hands.right.tracked ? 'yes' : 'no'} (${pct(s.right)})  grip ${this.input.describe('right')}  arm ${arm('right')}`,
      `left hand ${f.hands.left.tracked ? 'yes' : 'no'} (${pct(s.left)})  grip ${this.input.describe('left')}  arm ${arm('left')}`,
    ]
    g.fillStyle = 'rgba(0,0,0,0.6)'
    g.fillRect(0, h - 64, w, 64)
    g.fillStyle = '#ffffff'
    g.font = '13px ui-monospace, monospace'
    rows.forEach((r, i) => g.fillText(r, 8, h - 46 + i * 18))
  }

  painStop() {
    this.record.painStop = true
    this.voice.say('pain_stop', true)
    this.end()
  }

  end() {
    this.running = false
    this.director.end()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.voice.stop()
    this.tracker?.close()
    this.composer?.dispose()
    this.gtao?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
