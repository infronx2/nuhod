/**
 * The majlis session, ported from NuhoudTaskDirector.cpp: hang a lantern on the hook (reach, grasp,
 * lift, release), serve a date on the guest plate (pinch, carry, release) and eat a date (hand to
 * mouth), in turn. Targets grow after a while so every task stays reachable, a task finished only
 * thanks to that growth (or by touch) counts as assisted, and the doctor's daily goal ends the session.
 */
import * as THREE from 'three'
import { HANG_SLOTS, LAYOUT, MOUTH, TABLE, EYES, tablePoint, ue } from './space'
import { DateFruit, Dallah, Finjan, Lantern, TargetMarker, lanternSpot, perceived, plateSpot, type Grabbable } from './props'
import type { HandInput } from './input'
import type { SessionRecord } from './session'
import type { ArmSample, Side } from './tracking'

const INITIAL_LANTERNS = 2
const FULL_POINTS = 100, ASSISTED_POINTS = 50
const TIMEOUT_S = { lantern: 45, serve: 60, eat: 60 }
const TOUCH_LIGHTING_AFTER_S = 10
const HOLD_ON_TARGET_S = 0.6
const HOOK_CATCH = 16, HOOK_RELEASE = 20, HOOK_MIN_ABOVE_TABLE = 30
const PLATE_RADIUS = 14, PLATE_RELEASE = 18, PLATE_HELD_MAX_H = 20, PLATE_BELOW_TOL = 6
const MOUTH_RADIUS = 16
const ASSIST_AFTER_S = 15, ASSIST_RAMP_S = 20, MAX_ASSIST = 1.8

export type TaskKind = 'lantern' | 'serve' | 'eat'
const ORDER: TaskKind[] = ['lantern', 'serve', 'eat']

export interface Plan {
  targetAngle: number
  dailyTasks: number // 0 = no limit
  limb: 'right' | 'left' | 'both'
}

export interface DirectorEvents {
  say(event: string, interrupt?: boolean): void
  finish(reason: 'goal'): void
}

export class TaskDirector {
  readonly dates: DateFruit[] = []
  readonly props: Grabbable[] = []
  private lantern: Lantern | null = null
  private marker: TargetMarker | null = null
  private hanging: Lantern[] = []
  private nextSlot = 0
  task: TaskKind = 'lantern'
  taskSide: Side = 'right'
  taskCount = 0
  active = false
  over = false
  taskTime = 0
  private onTarget = 0
  private difficulty = 0.3
  private nextEncourage = 14
  private timers: Array<{ at: number; fn: () => void }> = []
  private clock = 0
  feedback = ''
  private feedbackTime = 0

  constructor(private scene: THREE.Scene, private input: HandInput, private record: SessionRecord, private plan: Plan,
    private events: DirectorEvents, private arms: () => Partial<Record<Side, ArmSample>>) {
    // Nine dates heaped in the bowl, three cups, the dallah on its tray.
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : 2.2 + (i % 3) * 1.1
      const z = LAYOUT.bowlFloorZ + 1.25 + (i % 2) * 0.9 + (i === 0 ? 1.2 : 0)
      const d = new DateFruit()
      d.setHome(tablePoint(LAYOUT.bowl[0] + Math.cos(a) * r, LAYOUT.bowl[1] + Math.sin(a) * r, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 40 * Math.PI) / 180))
      d.onReleased = (g) => this.onDateReleased(g)
      this.dates.push(d)
      scene.add(d.object)
    }
    for (const [x, y] of LAYOUT.cups) {
      const c = new Finjan()
      c.setHome(tablePoint(x, y))
      this.props.push(c)
      scene.add(c.object)
    }
    const dallah = new Dallah()
    dallah.setHome(tablePoint(LAYOUT.tray[0], LAYOUT.tray[1], LAYOUT.trayTopZ))
    this.props.push(dallah)
    scene.add(dallah.object)
    // Two lanterns already burning so the room is warm before the first repetition.
    for (let i = 0; i < INITIAL_LANTERNS; i++) {
      const l = new Lantern()
      scene.add(l.object)
      l.hangAsDecoration(HANG_SLOTS[HANG_SLOTS.length - 1 - i], true)
    }
  }

  /** Every object that can ever be picked up (the input checks which are enabled). */
  grabbables(): Grabbable[] {
    return [...this.dates, ...this.props, ...(this.lantern ? [this.lantern] : [])]
  }

  private after(seconds: number, fn: () => void) { this.timers.push({ at: this.clock + seconds, fn }) }

  start() {
    const hand = this.plan.limb === 'right' ? 'بيدك اليمنى' : this.plan.limb === 'left' ? 'بيدك اليسرى' : 'بأي يد'
    this.say(this.plan.dailyTasks > 0 ? `اليوم: ${this.plan.dailyTasks} مهام ${hand}` : `اليوم: تمرّن ${hand} على راحتك`, 4)
    this.events.say('session_start')
    this.after(4, () => this.startNext())
  }

  end() {
    if (this.over) return
    this.over = true
    this.active = false
    this.timers = []
    this.clearTaskObjects()
  }

  private say(text: string, seconds: number) {
    this.feedback = text
    this.feedbackTime = seconds
  }

  private clearTaskObjects() {
    if (this.lantern && !this.lantern.decoration) this.scene.remove(this.lantern.object)
    if (this.marker) this.scene.remove(this.marker.object)
    this.lantern = null
    this.marker = null
  }

  private startNext() {
    if (this.over) return
    this.clearTaskObjects()
    this.task = ORDER[this.taskCount % 3]
    this.taskSide = this.plan.limb === 'right' ? 'right' : this.plan.limb === 'left' ? 'left' : this.taskCount % 2 === 0 ? 'right' : 'left'
    this.taskCount++
    this.taskTime = 0
    this.onTarget = 0
    this.nextEncourage = 14
    this.active = true
    const right = this.taskSide === 'right'
    // The first round explains every task; after that only now and then, so it does not nag.
    if (this.taskCount <= 3 || Math.random() < 0.35) this.events.say(`task_${this.task}`, true)

    if (this.task === 'lantern') {
      const l = new Lantern()
      l.setHome(lanternSpot(right).add(new THREE.Vector3(0, l.restHeight, 0)))
      l.onReleased = (g) => this.onLanternReleased(g as Lantern)
      l.onTouchLit = (x) => this.onLanternTouchLit(x)
      this.scene.add(l.object)
      this.lantern = l
      this.marker = new TargetMarker('hook', this.chooseHook(this.taskSide))
      this.scene.add(this.marker.object)
    } else if (this.task === 'serve') {
      this.marker = new TargetMarker('plate', plateSpot(right))
      this.scene.add(this.marker.object)
    }
    // Only this task's objects can be picked up.
    for (const d of this.dates) d.enabled = this.task !== 'lantern'
    if (this.lantern) this.lantern.enabled = true
    for (const p of this.props) p.enabled = false
  }

  private assistScale() {
    return 1 + (MAX_ASSIST - 1) * THREE.MathUtils.clamp((this.taskTime - ASSIST_AFTER_S) / ASSIST_RAMP_S, 0, 1)
  }

  private complete(points: number, message: string) {
    this.active = false
    this.onTarget = 0
    this.record.recordTask(points, points < FULL_POINTS)
    if (this.task === 'lantern') {
      const step = this.taskTime < 10 ? 0.08 : this.taskTime > 25 ? -0.08 : 0.03
      this.difficulty = THREE.MathUtils.clamp(this.difficulty + step, 0, 1)
    }
    this.say(`${message}  +${points}`, 2)
    this.events.say(points < FULL_POINTS ? 'task_assisted' : this.taskTime < 6 ? 'task_done_fast' : 'task_done', true)
    if (this.plan.dailyTasks > 0 && this.record.reps >= this.plan.dailyTasks) {
      this.say(`أنجزت هدف اليوم: ${this.record.reps} مهام. أحسنت!`, 6)
      this.events.say('goal_reached', true)
      this.after(3, () => this.events.finish('goal'))
      return
    }
    this.after(2.2, () => this.startNext())
  }

  private fail() {
    this.active = false
    this.record.recordFailed()
    if (this.task === 'lantern') this.difficulty = Math.max(0, this.difficulty - 0.15)
    this.say('ولا يهمك، نجرب وحدة ثانية', 2)
    this.events.say('task_fail', true)
    this.clearTaskObjects()
    this.after(1.5, () => this.startNext())
  }

  update(dt: number) {
    this.clock += dt
    const due = this.timers.filter((t) => t.at <= this.clock)
    this.timers = this.timers.filter((t) => t.at > this.clock)
    due.forEach((t) => t.fn())
    this.feedbackTime = Math.max(0, this.feedbackTime - dt)
    for (const g of [...this.dates, ...this.props, ...this.hanging]) g.update(dt)
    if (this.lantern && !this.hanging.includes(this.lantern)) this.lantern.update(dt)
    this.marker?.update(dt)
    if (!this.active) return
    // The clock only runs while the camera sees a hand.
    if (!this.input.isVisible('right') && !this.input.isVisible('left')) return
    this.taskTime += dt
    if (this.task === 'lantern') this.evaluateLantern(dt)
    else if (this.task === 'serve') this.evaluateServe(dt)
    else this.evaluateEat()
    if (this.active && this.taskTime > this.nextEncourage) {
      this.events.say('encourage')
      this.nextEncourage = this.taskTime + 14
    }
    if (this.active && this.taskTime > TIMEOUT_S[this.task]) this.fail()
  }

  // ── Lantern ──────────────────────────────────────────────────────────────
  private palms(): THREE.Vector3[] {
    return (['right', 'left'] as Side[]).filter((s) => this.input.isVisible(s)).map((s) => this.input.palm(s))
  }

  private evaluateLantern(dt: number) {
    const l = this.lantern, m = this.marker
    if (!l || !m) return
    let nearest = Infinity
    for (const p of this.palms()) nearest = Math.min(nearest, perceived(p, l.closestSurfacePoint(p)))
    l.allowTouchLighting = this.taskTime > TOUCH_LIGHTING_AFTER_S
    l.nearestPalm = nearest
    // Holding it steady at the hook also counts, for patients who cannot open the hand yet.
    const held = l.state === 'held'
    const hookD = perceived(l.anchor, m.object.position)
    this.onTarget = held && hookD < HOOK_CATCH * this.assistScale() ? this.onTarget + dt : 0
    m.setProgress(this.onTarget / HOLD_ON_TARGET_S)
    if (this.onTarget > HOLD_ON_TARGET_S) this.hangOnHook(hookD >= HOOK_CATCH)
  }

  private onLanternReleased(l: Lantern) {
    if (!this.active || this.task !== 'lantern' || l !== this.lantern || !this.marker) return
    const d = perceived(l.anchor, this.marker.object.position)
    if (d < HOOK_RELEASE * this.assistScale()) this.hangOnHook(d >= HOOK_RELEASE)
  }

  private hangOnHook(assisted: boolean) {
    const l = this.lantern!, m = this.marker!
    this.lantern = null
    this.marker = null
    l.placeAt(m.object.position.clone().sub(new THREE.Vector3(0, Lantern.ANCHOR_Y, 0)))
    l.lightUp()
    m.celebrate()
    this.complete(assisted ? ASSISTED_POINTS : FULL_POINTS, 'أحسنت! المجلس صار أنور')
    this.hanging.push(l)
    this.after(1.4, () => {
      this.hangDecoration(l)
      this.scene.remove(m.object)
    })
  }

  private onLanternTouchLit(l: Lantern) {
    if (!this.active || this.task !== 'lantern' || l !== this.lantern) return
    const m = this.marker
    this.lantern = null
    this.marker = null
    m?.celebrate()
    this.complete(ASSISTED_POINTS, 'اشتعل! المرة الجاية حاول تقبض عليه')
    this.hanging.push(l)
    this.after(1.4, () => {
      this.hangDecoration(l)
      if (m) this.scene.remove(m.object)
    })
  }

  private hangDecoration(l: Lantern) {
    const usable = Math.max(1, HANG_SLOTS.length - INITIAL_LANTERNS)
    const decorations = this.hanging.filter((x) => x.decoration)
    // Once every hook is used, the oldest lantern makes room for the newest.
    if (decorations.length >= usable) {
      const oldest = decorations[0]
      this.scene.remove(oldest.object)
      this.hanging = this.hanging.filter((x) => x !== oldest)
    }
    l.hangAsDecoration(HANG_SLOTS[this.nextSlot % usable], false)
    this.nextSlot++
  }

  /** A hook in the patient's reach, centred on the doctor's target angle (ChooseHookLocation). */
  private chooseHook(side: Side): THREE.Vector3 {
    const arm = this.arms()[side]
    const sign = side === 'right' ? 1 : -1
    const shoulder = arm ? new THREE.Vector3(...arm.shoulder) : new THREE.Vector3(-4, 17 * sign, -24)
    const reach = arm && arm.upperArmCm > 10 && arm.forearmCm > 10 ? arm.upperArmCm + arm.forearmCm + 7 : 60
    const target = this.plan.targetAngle
    const low = THREE.MathUtils.clamp(target - 15 + 10 * this.difficulty, 20, 160)
    const high = THREE.MathUtils.clamp(target + 10 * this.difficulty, low, 165)
    const elev = THREE.MathUtils.degToRad(low + Math.random() * (high - low))
    const plane = THREE.MathUtils.degToRad(Math.random() * 40)
    const dist = reach * THREE.MathUtils.lerp(0.6, 0.9, this.difficulty)
    // Game axes relative to the eyes: x forward, y right, z up.
    const local = shoulder.clone().add(new THREE.Vector3(
      Math.sin(elev) * Math.cos(plane), sign * Math.sin(elev) * Math.sin(plane), -Math.cos(elev)).multiplyScalar(dist))
    local.z = Math.max(local.z, TABLE.top + HOOK_MIN_ABOVE_TABLE - 90)
    local.x = Math.max(local.x, 25, -local.z, Math.abs(local.y) * 1.2)
    return EYES.clone().add(ue(local.x, local.y, local.z))
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  private plateDistance(g: Grabbable, maxH: number): number {
    if (!this.marker) return Infinity
    const top = this.marker.plateTop
    const p = g.position
    const h = p.y - top.y
    if (h < -PLATE_BELOW_TOL || h > maxH) return Infinity
    return perceived(new THREE.Vector3(p.x, top.y, p.z), top)
  }

  private evaluateServe(dt: number) {
    if (!this.marker) return
    const r = PLATE_RADIUS * this.assistScale()
    let overPlate = false
    for (const d of this.dates) {
      if (d.state === 'held') {
        const dist = this.plateDistance(d, PLATE_HELD_MAX_H)
        if (dist < r) {
          overPlate = true
          if (this.onTarget + dt > HOLD_ON_TARGET_S) return this.serve(d, dist >= PLATE_RADIUS)
        }
      } else if (d.state === 'free') {
        const dist = this.plateDistance(d, 4)
        if (dist < r) return this.serve(d, dist >= PLATE_RADIUS)
      }
    }
    this.onTarget = overPlate ? this.onTarget + dt : 0
    this.marker.setProgress(this.onTarget / HOLD_ON_TARGET_S)
  }

  private onDateReleased(g: Grabbable) {
    if (!this.active || this.task !== 'serve') return
    const d = this.plateDistance(g, 20)
    if (d < PLATE_RELEASE * this.assistScale()) this.serve(g, d >= PLATE_RELEASE)
  }

  private serve(d: Grabbable, assisted: boolean) {
    const m = this.marker!
    this.marker = null
    d.placeAt(m.plateTop.add(new THREE.Vector3(0, d.restHeight, 0)))
    m.celebrate()
    this.complete(assisted ? ASSISTED_POINTS : FULL_POINTS, 'شكراً! قدّمت التمرة لضيفك')
    this.after(1.8, () => {
      d.returnHome()
      this.scene.remove(m.object)
    })
  }

  private evaluateEat() {
    for (const d of this.dates) {
      if (d.state !== 'held') continue
      const dist = perceived(d.position, MOUTH)
      if (dist < MOUTH_RADIUS * this.assistScale()) {
        d.eat()
        this.complete(dist >= MOUTH_RADIUS ? ASSISTED_POINTS : FULL_POINTS, 'بالهنا والعافية!')
        return
      }
    }
  }

  /** Where the current task's object and target are (for the ?sim scripted patient). */
  simTargets() {
    const held = [...this.dates, ...(this.lantern ? [this.lantern] : [])].find((g) => g.state === 'held')
    const date = this.dates.find((d) => d.state === 'home')
    return {
      task: this.active ? this.task : null,
      pick: this.task === 'lantern' ? this.lantern?.position.clone() ?? null : date?.position.clone() ?? null,
      place: this.task === 'lantern' ? this.marker?.object.position.clone() ?? null : this.task === 'serve' ? this.marker?.plateTop ?? null : MOUTH.clone(),
      holding: !!held,
    }
  }

  // ── Guidance ─────────────────────────────────────────────────────────────
  instruction(): string {
    if (this.feedbackTime > 0) return this.feedback
    if (!this.active) return ''
    const anyDateHeld = this.dates.some((d) => d.state === 'held')
    if (this.task === 'lantern') {
      if (this.lantern?.state === 'held') return 'ارفعه للخطاف المضيء، وبعدين افتح يدك'
      return this.taskTime > TOUCH_LIGHTING_AFTER_S ? 'اقبض على الفانوس، أو حط كفّك عليه' : 'امسك الفانوس وعلّقه على الخطاف المضيء'
    }
    if (this.task === 'serve') return anyDateHeld ? 'حط التمرة على الصحن المضيء وافتح أصابعك' : 'اقرص تمرة من الصحن وقدّمها لضيفك'
    return anyDateHeld ? 'قرّب التمرة من فمك' : 'اقرص تمرة من الصحن وكُلها'
  }
}
