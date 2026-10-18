/**
 * The web majlis session: renders the room from the patient's seat, tracks the camera every frame,
 * drives the hands and the task director, and keeps the session record.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildMajlis } from './majlis'
import { RiggedHand } from './hands'
import { HandInput } from './input'
import { SessionRecord } from './session'
import { TaskDirector, type Plan } from './tasks'
import { Tracker, type ArmSample, type Side, type TrackFrame } from './tracking'
import { Voice } from './voice'
import { SimPatient } from './sim'
import { EYES, ue } from './space'

/** ?debug in the address exposes tracking values on window.__nuhoud. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
/** ?handtest moves the tracked arms forward over the table (finger shape unchanged), to check the hand mesh. */
const HANDTEST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('handtest')
/** ?sim replaces the camera with a scripted patient (testing without a camera). */
const SIM = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sim')
const HANDTEST_OPEN = HANDTEST && new URLSearchParams(window.location.search).get('handtest') === 'open'

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

  constructor(private container: HTMLElement, private video: HTMLVideoElement, private plan: Plan,
    private onHud: (s: HudState) => void, private onFinish: (reason: 'goal') => void) {
    const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowEnd ? 1.25 : 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x1d140d)
    // Soft room reflections so brass and porcelain read as metal and glaze, not black.
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

    for (const h of Object.values(this.hands)) this.scene.add(h.root)
    this.input = new HandInput(this.hands, () => this.director.grabbables(), {
      onGrab: (pinch, side) => this.record.recordGrab(pinch, side === 'right'),
      onGripSample: (c, p) => this.record.recordGrip(c, p),
    })
    this.input.active = { right: plan.limb !== 'left', left: plan.limb !== 'right' }
    this.director = new TaskDirector(this.scene, this.input, this.record, plan,
      { say: (e, i) => this.voice.say(e, i), finish: (r) => this.onFinish(r) }, () => this.arms)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  async load() {
    await Promise.all([this.hands.right.load('/play/hands/right.glb'), this.hands.left.load('/play/hands/left.glb')])
    if (SIM) this.sim = new SimPatient()
    else this.tracker = await Tracker.create('/play')
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    // Keep the table and the hooks in view in portrait too.
    this.camera.fov = w / h < 1 ? 82 : 62
    this.camera.updateProjectionMatrix()
  }

  /** Tracking only (for the "can the camera see you" step), without the tasks. */
  startPreview() {
    this.running = false
    this.loop(performance.now())
  }

  start() {
    this.running = true
    this.director.start()
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0)
    this.last = t
    const now = t / 1000

    const camFrame = this.tracker && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime
    if (camFrame || this.sim) {
      this.lastVideoTime = this.video.currentTime
      const f = this.sim ? this.sim.frame(now, this.director.simTargets()) : this.tracker!.process(this.video, t)
      this.lastFrame = f
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
    if (this.running) this.director.update(dt)
    this.renderer.render(this.scene, this.camera)

    const f = this.lastFrame
    if (DEBUG) {
      ;(window as unknown as { __game: unknown }).__game = { hands: this.hands }
      ;(window as unknown as { __nuhoud: unknown }).__nuhoud = {
        body: f?.body,
        arms: Object.fromEntries((['right', 'left'] as Side[]).map((s) => [s, f?.arms[s] && { tracked: f.arms[s]!.tracked, wrist: f.arms[s]!.wrist.map(Math.round), elev: Math.round(f.arms[s]!.shoulderElevation) }])),
        hands: { right: f?.hands.right.tracked, left: f?.hands.left.tracked },
        visible: { right: this.input.isVisible('right'), left: this.input.isVisible('left') },
        palm: (['right', 'left'] as Side[]).map((s) => this.hands[s].palm.toArray().map(Math.round)),
        grip: { right: this.input.describe('right'), left: this.input.describe('left') },
        task: this.running ? this.director.task : null,
      }
    }
    this.onHud({
      instruction: this.running ? this.director.instruction() : '',
      done: this.record.reps,
      goal: this.plan.dailyTasks,
      score: this.record.score,
      body: !!f?.body,
      hands: { right: this.input.isVisible('right'), left: this.input.isVisible('left') },
      fps: this.fps,
    })
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
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
