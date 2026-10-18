/**
 * The tools Mu'in can call, and the data they return.
 *
 * Privacy: nothing here sends a name, email or date of birth to the model. A patient is
 * "the patient" (or a roster code like P3 that the route maps back to the name after the reply),
 * and age is sent as a ten-year band.
 */
import { db } from '@/lib/db'
import { badgeBySlug } from '@/lib/badges'
import type { ToolSpec } from './deepseek'

export type MuinMode = 'patient' | 'doctor_patient' | 'doctor_roster'

/** A plan change Mu'in suggests; the doctor applies it with the plan editor's POST, never Mu'in. */
export interface PlanProposal {
  patientId: string
  title: string
  targetLimb: string
  targetAngle: number
  sessionsPerWeek: number
  dailyRepGoal: number
  notes: string | null
  reason: string
  current: { targetAngle: number; sessionsPerWeek: number; dailyRepGoal: number } | null
}

export interface ToolContext {
  mode: MuinMode
  patientId: string | null
  /** Roster codes (P1, P2...) to patient ids, filled by list_patients. */
  codes: Map<string, { id: string; name: string }>
  proposal: PlanProposal | null
}

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

// The data is fetched before the call (see contextData in agent.ts), so the model's only tool is
// the doctor's plan proposal: every extra tool round would resend the whole prompt.
const PROPOSE_PLAN_CHANGE = fn(
  'propose_plan_change',
  'Suggest a change to the active plan. It is shown to the doctor as a card to approve; it changes nothing by itself. Only suggest changes the data supports.',
  {
    targetAngle: { type: 'integer', minimum: 10, maximum: 180 },
    dailyRepGoal: { type: 'integer', minimum: 1, maximum: 200 },
    sessionsPerWeek: { type: 'integer', minimum: 1, maximum: 14 },
    reason: { type: 'string', description: 'One sentence, in the language of the conversation, citing the data.' },
  },
  ['reason'],
)

export function toolsFor(mode: MuinMode): ToolSpec[] {
  return mode === 'doctor_patient' ? [PROPOSE_PLAN_CHANGE] : []
}

/** Runs a tool the model called. */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<unknown> {
  let args: Record<string, unknown> = {}
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {}
  } catch {
    return { error: 'arguments were not valid JSON' }
  }
  if (name === 'propose_plan_change' && ctx.mode === 'doctor_patient' && ctx.patientId) {
    return proposePlanChange(ctx.patientId, args, ctx)
  }
  return { error: `unknown tool ${name}` }
}

// ---------------------------------------------------------------------------------------------

/** Age, affected side and plan in one line, for the system prompt (no identifiers). */
export async function patientProfile(patientId: string) {
  const [user, plan] = await Promise.all([
    db.user.findUnique({ where: { id: patientId }, select: { affectedSide: true, dateOfBirth: true } }),
    getPlan(patientId),
  ])
  if (!user) return null
  return { ageBand: ageBand(user.dateOfBirth), affectedSide: user.affectedSide, plan }
}

export async function getProgress(patientId: string) {
  const since = new Date(Date.now() - 6 * 86_400_000)
  since.setHours(0, 0, 0, 0)
  const [agg, days, week, streak, plan] = await Promise.all([
    db.rehabSession.aggregate({
      where: { patientId },
      _count: true,
      _sum: { totalReps: true, correctReps: true, durationSeconds: true },
      _max: { maxAchievedAngle: true, gripClosureMax: true },
    }),
    db.rehabSession.findMany({ where: { patientId }, select: { sessionDate: true } }),
    db.rehabSession.findMany({
      where: { patientId, sessionDate: { gte: since } },
      select: { sessionDate: true, totalReps: true, maxAchievedAngle: true },
    }),
    db.streak.findUnique({ where: { userId: patientId } }),
    db.treatmentPlan.findFirst({ where: { patientId, active: true }, orderBy: { createdAt: 'desc' } }),
  ])
  const reps = agg._sum.totalReps ?? 0
  const correct = agg._sum.correctReps ?? 0
  const last7 = new Map<string, { reps: number; sessions: number; bestAngle: number }>()
  for (let i = 6; i >= 0; i--) last7.set(dayKey(new Date(Date.now() - i * 86_400_000)), { reps: 0, sessions: 0, bestAngle: 0 })
  for (const s of week) {
    const d = last7.get(dayKey(s.sessionDate))
    if (d) {
      d.reps += s.totalReps
      d.sessions += 1
      d.bestAngle = Math.max(d.bestAngle, Math.round(s.maxAchievedAngle))
    }
  }
  const today = last7.get(dayKey(new Date()))!
  return {
    allTimeSessions: agg._count,
    allTimeTasks: reps,
    allTimeCorrectTasks: correct,
    allTimeAccuracyPct: reps ? Math.round((correct / reps) * 100) : null,
    allTimeMinutes: Math.round((agg._sum.durationSeconds ?? 0) / 60),
    allTimeBestAngleDeg: Math.round(agg._max.maxAchievedAngle ?? 0),
    allTimeBestGripPct: Math.round(agg._max.gripClosureMax ?? 0),
    activeDays: new Set(days.map((d) => dayKey(d.sessionDate))).size,
    streakDays: streak?.currentStreak ?? 0,
    longestStreakDays: streak?.longestStreak ?? 0,
    last7Days: Array.from(last7.entries()).map(([day, v]) => ({ day, ...v })),
    today: { tasks: today.reps, sessions: today.sessions, dailyGoal: plan?.dailyRepGoal ?? null },
  }
}

export async function getRecentSessions(patientId: string, limit: number) {
  const rows = await db.rehabSession.findMany({
    where: { patientId },
    orderBy: { sessionDate: 'desc' },
    take: limit,
  })
  return rows.map(sessionFacts)
}

export function sessionFacts(s: {
  sessionDate: Date; source: string; limb: string; durationSeconds: number; totalReps: number; correctReps: number
  maxAchievedAngle: number; gripClosureMax: number; pinchMinCm: number; graspCount: number; pinchCount: number
  tasksAssisted: number; painStop: boolean; compensationErrors: number; gamificationScore: number
}) {
  return {
    date: s.sessionDate.toISOString().slice(0, 16).replace('T', ' '),
    game: s.source === 'ue5' || s.source.startsWith('ue') ? 'majlis' : s.source,
    limb: s.limb,
    minutes: Math.round(s.durationSeconds / 6) / 10,
    tasks: s.totalReps,
    correctTasks: s.correctReps,
    maxAngleDeg: Math.round(s.maxAchievedAngle),
    gripClosurePct: Math.round(s.gripClosureMax),
    closestPinchCm: s.pinchMinCm ? Math.round(s.pinchMinCm * 10) / 10 : null,
    fistPickups: s.graspCount,
    pinchPickups: s.pinchCount,
    assistedTasks: s.tasksAssisted,
    compensationErrors: s.compensationErrors,
    painStop: s.painStop,
    score: s.gamificationScore,
  }
}

export async function getPlan(patientId: string) {
  const p = await db.treatmentPlan.findFirst({ where: { patientId, active: true }, orderBy: { createdAt: 'desc' } })
  if (!p) return null
  return {
    title: p.title,
    limb: p.targetLimb,
    targetAngleDeg: p.targetAngle,
    sessionsPerWeek: p.sessionsPerWeek,
    dailyTaskGoal: p.dailyRepGoal,
    doctorNotes: p.notes,
    since: p.startDate.toISOString().slice(0, 10),
  }
}

export async function getBadges(patientId: string) {
  const rows = await db.earnedBadge.findMany({ where: { userId: patientId }, orderBy: { earnedAt: 'desc' } })
  return rows.map((b) => {
    const def = badgeBySlug(b.slug)
    return { name: def?.nameAr ?? b.slug, nameEn: def?.name ?? b.slug, earned: b.earnedAt.toISOString().slice(0, 10) }
  })
}

async function proposePlanChange(patientId: string, args: Record<string, unknown>, ctx: ToolContext) {
  const plan = await db.treatmentPlan.findFirst({ where: { patientId, active: true }, orderBy: { createdAt: 'desc' } })
  const reason = String(args.reason || '').slice(0, 400)
  const num = (v: unknown, lo: number, hi: number, cur: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : cur
  const targetAngle = num(args.targetAngle, 10, 180, plan?.targetAngle ?? 45)
  const dailyRepGoal = num(args.dailyRepGoal, 1, 200, plan?.dailyRepGoal ?? 10)
  const sessionsPerWeek = num(args.sessionsPerWeek, 1, 14, plan?.sessionsPerWeek ?? 5)
  if (plan && targetAngle === plan.targetAngle && dailyRepGoal === plan.dailyRepGoal && sessionsPerWeek === plan.sessionsPerWeek) {
    return { error: 'that is the current plan; nothing to propose' }
  }
  ctx.proposal = {
    patientId,
    title: plan?.title ?? 'Upper-limb rehab plan',
    targetLimb: plan?.targetLimb ?? 'upper_right',
    targetAngle,
    sessionsPerWeek,
    dailyRepGoal,
    notes: plan?.notes ?? null,
    reason,
    current: plan ? { targetAngle: plan.targetAngle, sessionsPerWeek: plan.sessionsPerWeek, dailyRepGoal: plan.dailyRepGoal } : null,
  }
  return { ok: true, shownToDoctorForApproval: true, targetAngle, dailyRepGoal, sessionsPerWeek }
}

/** Every patient as a roster code (P1, P2...) with progress indicators; fills ctx.codes for unmasking. */
export async function listPatients(ctx: ToolContext) {
  const patients = await db.user.findMany({
    where: { role: 'PATIENT', active: true },
    select: { id: true, name: true, affectedSide: true, dateOfBirth: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  const ids = patients.map((p) => p.id)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [sessions, plans] = await Promise.all([
    db.rehabSession.findMany({
      where: { patientId: { in: ids } },
      orderBy: { sessionDate: 'desc' },
      select: { patientId: true, sessionDate: true, maxAchievedAngle: true, painStop: true, tasksAssisted: true, totalReps: true, compensationErrors: true },
      take: 3000,
    }),
    db.treatmentPlan.findMany({ where: { patientId: { in: ids }, active: true }, select: { patientId: true, targetAngle: true, sessionsPerWeek: true } }),
  ])
  ctx.codes.clear()
  return patients.map((p, i) => {
    const code = `P${i + 1}`
    ctx.codes.set(code, { id: p.id, name: p.name })
    const mine = sessions.filter((s) => s.patientId === p.id).slice(0, 6)
    const plan = plans.find((x) => x.patientId === p.id)
    const half = Math.floor(mine.length / 2)
    const mean = (xs: typeof mine) => xs.reduce((a, s) => a + s.maxAchievedAngle, 0) / (xs.length || 1)
    const lastAt = mine[0]?.sessionDate
    return {
      code,
      ageBand: ageBand(p.dateOfBirth),
      side: p.affectedSide,
      targetAngleDeg: plan?.targetAngle ?? null,
      sessionsThisWeek: mine.filter((s) => s.sessionDate >= weekAgo).length,
      plannedPerWeek: plan?.sessionsPerWeek ?? null,
      daysSinceLastSession: lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86_400_000) : null,
      lastMaxAngleDeg: mine[0] ? Math.round(mine[0].maxAchievedAngle) : null,
      angleTrendDeg: mine.length >= 2 ? Math.round(mean(mine.slice(0, half)) - mean(mine.slice(half))) : null,
      painStopsRecent: mine.filter((s) => s.painStop).length,
      assistedShare: (() => {
        const reps = mine.reduce((a, s) => a + s.totalReps, 0)
        return reps ? Math.round((mine.reduce((a, s) => a + s.tasksAssisted, 0) / reps) * 100) / 100 : null
      })(),
    }
  })
}

// ---------------------------------------------------------------------------------------------

function ageBand(dob: string | null): string | null {
  if (!dob) return null
  const t = new Date(dob).getTime()
  if (Number.isNaN(t)) return null
  const age = Math.floor((Date.now() - t) / (365.25 * 86_400_000))
  if (age < 0 || age > 120) return null
  const lo = Math.floor(age / 10) * 10
  return `${lo}-${lo + 9}`
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
