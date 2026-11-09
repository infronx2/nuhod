'use client'

/**
 * The hand lab (/play/lab, development only): drives the realistic hands with exact, known hand
 * poses — every finger shape in every wrist and forearm orientation, both hands — and measures how
 * far each bone points from the landmarks it should follow. It renders the pose it is testing, so
 * a failing case can be looked at, and exposes window.__lab for scripted runs:
 *
 *   await __lab.run()                       → summary + worst cases
 *   __lab.show('right', 'fist', 'palmUp', 'front')
 */
import * as React from 'react'
import * as THREE from 'three'
import { RiggedHand, handFromCurls } from './hands'
import { loadEnvironment, setMaxAnisotropy } from './assets'
import { EYES, ue } from './space'
import type { ArmSample, HandSample, Side, Vec } from './tracking'

type Curls = Array<[number, number, number]>

/** Finger bends in degrees ([knuckle, middle, end] per finger, thumb first). */
export const SHAPES: Record<string, Curls> = {
  open: [[10, 10, 5], [12, 10, 5], [12, 10, 5], [12, 10, 5], [12, 10, 5]],
  flat: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  fist: [[40, 40, 30], [80, 95, 60], [80, 95, 60], [80, 95, 60], [80, 95, 60]],
  pinch: [[30, 30, 20], [35, 55, 30], [40, 60, 30], [40, 60, 30], [40, 60, 30]],
  point: [[40, 40, 30], [5, 5, 5], [80, 95, 60], [80, 95, 60], [80, 95, 60]],
  thumbsUp: [[0, 0, 0], [80, 95, 60], [80, 95, 60], [80, 95, 60], [80, 95, 60]],
  hook: [[10, 10, 5], [5, 90, 70], [5, 90, 70], [5, 90, 70], [5, 90, 70]],
}

/**
 * Forearm and wrist orientations (degrees): roll turns the palm (0 down, 180 up), flex bends the
 * wrist (+ toward the palm), dev tilts it toward the little finger (+) or the thumb (-), elev raises
 * the forearm, azim swings it inward (+) across the body.
 */
export const ORIENTS: Record<string, { roll?: number; flex?: number; dev?: number; elev?: number; azim?: number }> = {
  palmDown: {},
  palmUp: { roll: 180 },
  thumbUp: { roll: 90 },
  thumbDown: { roll: -90 },
  flex60: { flex: 60 },
  extend50: { flex: -50 },
  radial20: { dev: -20 },
  ulnar30: { dev: 30 },
  armUp70: { elev: 70 },
  armDown30: { elev: -30 },
  armIn40: { azim: 40 },
  armOut40: { azim: -40 },
  reachForward: { elev: 10, roll: 60 },
  combo: { roll: 130, flex: 35, dev: 15, elev: 35, azim: 20 },
}

const rot = (axis: 'x' | 'y' | 'z', deg: number) =>
  new THREE.Matrix4()[axis === 'x' ? 'makeRotationX' : axis === 'y' ? 'makeRotationY' : 'makeRotationZ'](THREE.MathUtils.degToRad(deg))

/**
 * A known pose as the tracker would report it: game cm, axes [forward, right, up]. The hand shape
 * is built palm down, fingers forward, then turned: forearm (elevation, swing), palm roll about the
 * forearm, then the wrist's deviation and bend. A left hand is the mirror image of a right one.
 */
export function syntheticPose(side: Side, shape: string, orient: string): { arm: ArmSample; hand: HandSample } {
  const o = ORIENTS[orient]
  const mirror = side === 'left' ? -1 : 1
  const R = new THREE.Matrix4()
    .multiply(rot('z', -(o.azim ?? 0) * mirror))
    .multiply(rot('y', -(o.elev ?? 0)))
    .multiply(rot('x', (o.roll ?? 0) * mirror))
    .multiply(rot('z', (o.dev ?? 0) * mirror))
    .multiply(rot('y', o.flex ?? 0))
  const pts: Vec[] = handFromCurls(SHAPES[shape]).map(([x, y, z]) => {
    const v = new THREE.Vector3(x, y * mirror, z).applyMatrix4(R)
    return [v.x, v.y, v.z]
  })
  const forearm = new THREE.Vector3(1, 0, 0)
    .applyMatrix4(rot('y', -(o.elev ?? 0)))
    .applyMatrix4(rot('z', -(o.azim ?? 0) * mirror))
  const wrist = new THREE.Vector3(38, 14 * mirror, -28)
  const elbow = wrist.clone().addScaledVector(forearm, -26)
  const shoulder = elbow.clone().add(new THREE.Vector3(-8, 4 * mirror, 26))
  const v = (p: THREE.Vector3): Vec => [p.x, p.y, p.z]
  return {
    arm: { tracked: true, shoulder: v(shoulder), elbow: v(elbow), wrist: v(wrist), upperArmCm: 28, forearmCm: 26, shoulderElevation: 30, elbowAngle: 90 },
    hand: { tracked: true, points: pts, dir: [1, 0, 0], normal: [0, 0, -1], curls: SHAPES[shape], pinchCm: 5 },
  }
}

interface CaseResult { side: Side; shape: string; orient: string; maxBone: number; worstBone: string; meanBone: number; palm: number; wristCm: number }

export function HandLab() {
  const host = React.useRef<HTMLDivElement>(null)
  const [status, setStatus] = React.useState('Loading the hands…')

  React.useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy())
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x26302f)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.copy(EYES).add(new THREE.Vector3(30, 60, 40))
    scene.add(key)
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000)
    const hands: Record<Side, RiggedHand> = { right: new RiggedHand('right'), left: new RiggedHand('left') }
    for (const h of Object.values(hands)) scene.add(h.root, h.forearm)
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    addEventListener('resize', resize)

    const pose = (side: Side, shape: string, orient: string) => {
      const { arm, hand } = syntheticPose(side, shape, orient)
      const h = hands[side]
      h.setVisible(true)
      for (let k = 0; k < 60; k++) h.update(arm, hand, 1)
      return h
    }
    const views: Record<string, THREE.Vector3> = {
      patient: new THREE.Vector3(0, 0, 0),
      front: new THREE.Vector3(0, 6, -70),
      side: new THREE.Vector3(55, 10, -25),
      top: new THREE.Vector3(0, 60, -25),
    }
    const show = (side: Side, shape: string, orient: string, view = 'front') => {
      hands.right.setVisible(false)
      hands.left.setVisible(false)
      const h = pose(side, shape, orient)
      const target = h.palm
      camera.position.copy(view === 'patient' ? EYES : target.clone().add(views[view] ?? views.front))
      camera.lookAt(target)
      renderer.render(scene, camera)
      const m = h.measure()
      const text = m
        ? `${side} · ${shape} · ${orient} · worst bone ${Math.max(...m.bones.map((b) => b.errDeg)).toFixed(1)}° · palm ${m.palmDeg.toFixed(1)}° · wrist ${m.wristCm.toFixed(2)} cm`
        : 'realistic hand not loaded'
      setStatus(text)
      return m
    }
    const run = async () => {
      const results: CaseResult[] = []
      for (const side of ['right', 'left'] as Side[]) {
        for (const shape of Object.keys(SHAPES)) {
          for (const orient of Object.keys(ORIENTS)) {
            const m = show(side, shape, orient)
            if (!m) continue
            const worst = m.bones.reduce((a, b) => (b.errDeg > a.errDeg ? b : a))
            results.push({ side, shape, orient, maxBone: worst.errDeg, worstBone: worst.name,
              meanBone: m.bones.reduce((s, b) => s + b.errDeg, 0) / m.bones.length, palm: m.palmDeg, wristCm: m.wristCm })
            await new Promise((r) => setTimeout(r, 0))
          }
        }
      }
      const by = (k: keyof CaseResult) => results.map((r) => r[k] as number)
      const summary = {
        cases: results.length,
        maxBoneDeg: Math.max(...by('maxBone')),
        meanBoneDeg: by('meanBone').reduce((s, x) => s + x, 0) / results.length,
        maxPalmDeg: Math.max(...by('palm')),
        maxWristCm: Math.max(...by('wristCm')),
        failing: results.filter((r) => r.maxBone > 8 || r.palm > 10 || r.wristCm > 0.5).length,
      }
      const worst = [...results].sort((a, b) => b.maxBone - a.maxBone).slice(0, 12)
      setStatus(`${summary.cases} cases · worst bone ${summary.maxBoneDeg.toFixed(1)}° · mean ${summary.meanBoneDeg.toFixed(2)}° · palm ≤ ${summary.maxPalmDeg.toFixed(1)}° · wrist ≤ ${summary.maxWristCm.toFixed(2)} cm · failing ${summary.failing}`)
      return { summary, worst, results }
    }
    ;(window as unknown as { __lab: unknown }).__lab = { run, show, shapes: Object.keys(SHAPES), orients: Object.keys(ORIENTS) }

    let cancelled = false
    void (async () => {
      await Promise.all([
        hands.right.loadRealistic('/play/assets/models/hand_realistic.glb'),
        hands.left.loadRealistic('/play/assets/models/hand_realistic.glb'),
        loadEnvironment(renderer, scene, 0.8),
      ])
      if (!cancelled) show('right', 'open', 'palmDown')
    })().catch((e) => setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`))
    return () => {
      cancelled = true
      removeEventListener('resize', resize)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-[#26302f]">
      <div ref={host} className="absolute inset-0" />
      <div dir="ltr" className="absolute start-3 top-3 max-w-[90vw] rounded-lg bg-black/60 px-3 py-2 font-mono text-xs text-white">{status}</div>
    </div>
  )
}
