import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type RehabSession } from '@prisma/client'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { awardBadges } from '@/lib/badges'

// GET /api/v2/sessions?patientId=...&limit=50
// Returns sessions for the current user (or, for doctors, for any patientId).
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const patientId = url.searchParams.get('patientId')
  const limit = clampInt(url.searchParams.get('limit'), 1, 500, 50)

  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const where = patientId
    ? isDoctor
      ? { patientId }
      : payload.sub === patientId
        ? { patientId }
        : { patientId: '__forbidden__' }
    : { patientId: payload.sub }

  const sessions = await db.rehabSession.findMany({
    where,
    orderBy: { sessionDate: 'desc' },
    take: limit,
    include: { patient: { select: { name: true, email: true } } },
  })
  return NextResponse.json({ ok: true, count: sessions.length, sessions })
}

// POST /api/v2/sessions — persist a completed rehab session.
// Auth required (the patient or a doctor on their behalf).
// Body: { patientId, planId?, source?, limb?, durationSeconds, totalReps,
//         correctReps, maxAchievedAngle, compensationErrors, gamificationScore,
//         angleTimeline?: number[], avgShoulderAngle?, maxElbowROM?,
//         gripClosureMax?, pinchMinCm?, graspCount?, pinchCount?, tasksAssisted?,
//         painStop?: boolean, sessionDate?: ISO string, clientSessionId?: string }
// The UE5 game keeps every session in a local file until this endpoint accepts it, so the
// same session can arrive twice; clientSessionId makes those replays return the stored row.
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }

  const required = [
    'patientId', 'durationSeconds', 'totalReps', 'correctReps',
    'maxAchievedAngle', 'compensationErrors', 'gamificationScore',
  ]
  for (const k of required) {
    if (body[k] === undefined || body[k] === null) {
      return NextResponse.json({ ok: false, error: `missing field: ${k}` }, { status: 400 })
    }
  }
  if (typeof body.patientId !== 'string') {
    return NextResponse.json({ ok: false, error: 'patientId must be a string' }, { status: 400 })
  }

  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  if (!isDoctor && payload.sub !== body.patientId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let clientSessionId: string | null = null
  if (body.clientSessionId !== undefined && body.clientSessionId !== null) {
    if (typeof body.clientSessionId !== 'string' || !CLIENT_SESSION_ID.test(body.clientSessionId)) {
      return NextResponse.json({ ok: false, error: 'invalid clientSessionId' }, { status: 400 })
    }
    clientSessionId = body.clientSessionId
    const existing = await db.rehabSession.findUnique({ where: { clientSessionId: clientSessionId! } })
    if (existing) return replayed(existing, body.patientId)
  }

  const patient = await db.user.findUnique({ where: { id: body.patientId } })
  if (!patient) {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  const sessionDate = parseSessionDate(body.sessionDate)
  const painStop = body.painStop === true

  let session: RehabSession
  try {
    session = await db.rehabSession.create({
      data: {
        patientId: body.patientId,
        planId: await resolvePlanId(body.planId, body.patientId),
        source: String(body.source || 'demo').slice(0, 32),
        limb: LIMBS.has(body.limb) ? body.limb : (patient.affectedSide || 'right'),
        ...(sessionDate ? { sessionDate } : {}),
        durationSeconds: clampInt(body.durationSeconds, 0, 86400, 0),
        totalReps: clampInt(body.totalReps, 0, 100000, 0),
        correctReps: clampInt(body.correctReps, 0, 100000, 0),
        maxAchievedAngle: clampFloat(body.maxAchievedAngle, 0, 180),
        avgShoulderAngle: clampFloat(body.avgShoulderAngle, 0, 180),
        maxElbowROM: clampFloat(body.maxElbowROM, 0, 180),
        gripClosureMax: clampFloat(body.gripClosureMax, 0, 100),
        pinchMinCm: clampFloat(body.pinchMinCm, 0, 30),
        graspCount: clampInt(body.graspCount, 0, 100000, 0),
        pinchCount: clampInt(body.pinchCount, 0, 100000, 0),
        tasksAssisted: clampInt(body.tasksAssisted, 0, 100000, 0),
        painStop,
        compensationErrors: clampInt(body.compensationErrors, 0, 100000, 0),
        gamificationScore: clampInt(body.gamificationScore, 0, 1000000, 0),
        angleTimeline: Array.isArray(body.angleTimeline)
          ? JSON.stringify(
              body.angleTimeline
                .slice(0, 5000)
                .filter((n: unknown) => typeof n === 'number' && Number.isFinite(n)),
            )
          : null,
        clientSessionId,
      },
    })
  } catch (err) {
    // Two uploads of the same offline session raced and the other one was stored first.
    if (clientSessionId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await db.rehabSession.findUnique({ where: { clientSessionId } })
      if (existing) return replayed(existing, body.patientId)
    }
    throw err
  }

  // The session is stored. Badges, streaks, goals and notifications are extras: if one fails the
  // client must still get a success, or the game would keep re-sending a session the doctor can see.
  const newBadges = await bestEffort('badges', () => awardBadges(body.patientId), [])
  const streakInfo = await bestEffort('streak', async () => {
    const { updateStreakOnSession } = await import('@/lib/streaks')
    return updateStreakOnSession(body.patientId, session.sessionDate)
  }, null)
  const goalResults = await bestEffort('goals', async () => {
    const { updateGoalsOnSession } = await import('@/lib/goals')
    return updateGoalsOnSession(body.patientId, session)
  }, { updated: 0, achieved: [] })

  await bestEffort('notifications', async () => {
    const { createNotification, notifyBadgesEarned } = await import('@/lib/notifications')
    await createNotification({
      userId: body.patientId,
      type: 'session_saved',
      title: painStop ? 'Session stopped for pain' : 'Session saved',
      body: `${session.totalReps} reps, ${session.maxAchievedAngle.toFixed(0)}° max ROM, score ${session.gamificationScore}.`,
      severity: painStop ? 'warning' : 'success',
      linkType: 'session',
      linkId: session.id,
    })
    if (newBadges.length > 0) {
      await notifyBadgesEarned(body.patientId, newBadges.map((b) => b.slug))
    }
    if (painStop) {
      // Every doctor with an active plan for this patient hears about a pain stop.
      const plans = await db.treatmentPlan.findMany({
        where: { patientId: body.patientId, active: true },
        select: { doctorId: true },
      })
      for (const doctorId of new Set(plans.map((p) => p.doctorId))) {
        await createNotification({
          userId: doctorId,
          type: 'info',
          title: `Pain stop: ${patient.name}`,
          body: `${patient.name} ended a session with the pain-stop button after ${Math.round(session.durationSeconds / 60)} min.`,
          severity: 'warning',
          linkType: 'session',
          linkId: session.id,
        })
      }
    }
  }, undefined)

  return NextResponse.json({ ok: true, session, newBadges, streak: streakInfo, goalAchievements: goalResults.achieved })
}

const CLIENT_SESSION_ID = /^[A-Za-z0-9-]{8,64}$/
const LIMBS = new Set(['right', 'left', 'bilateral'])

function replayed(existing: RehabSession, patientId: string) {
  if (existing.patientId !== patientId) {
    return NextResponse.json({ ok: false, error: 'clientSessionId already used by another patient' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, session: existing, duplicate: true, newBadges: [], streak: null, goalAchievements: [] })
}

/** The requested plan if it is this patient's, otherwise their active plan, otherwise none. */
async function resolvePlanId(requested: unknown, patientId: string): Promise<string | null> {
  if (typeof requested === 'string' && requested) {
    const plan = await db.treatmentPlan.findFirst({ where: { id: requested, patientId }, select: { id: true } })
    if (plan) return plan.id
  }
  const active = await db.treatmentPlan.findFirst({
    where: { patientId, active: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return active?.id ?? null
}

/** When the session happened, for uploads that were queued offline. Defaults to now. */
function parseSessionDate(v: unknown): Date | undefined {
  if (typeof v !== 'string') return undefined
  const d = new Date(v)
  const t = d.getTime()
  if (Number.isNaN(t)) return undefined
  const now = Date.now()
  if (t > now + 5 * 60_000 || t < now - 365 * 86_400_000) return undefined
  return d
}

async function bestEffort<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[sessions] ${label} failed after the session was saved`, err)
    return fallback
  }
}

function clampFloat(v: unknown, lo: number, hi: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(lo, Math.min(hi, n))
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : def
  if (!Number.isFinite(n)) return def
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
