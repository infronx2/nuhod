import { NextRequest, NextResponse } from 'next/server'
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
//         angleTimeline?: number[] }
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

  const required = [
    'patientId', 'durationSeconds', 'totalReps', 'correctReps',
    'maxAchievedAngle', 'compensationErrors', 'gamificationScore',
  ]
  for (const k of required) {
    if (body[k] === undefined || body[k] === null) {
      return NextResponse.json({ ok: false, error: `missing field: ${k}` }, { status: 400 })
    }
  }

  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  if (!isDoctor && payload.sub !== body.patientId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const patient = await db.user.findUnique({ where: { id: body.patientId } })
  if (!patient) {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  const session = await db.rehabSession.create({
    data: {
      patientId: body.patientId,
      planId: body.planId || null,
      source: String(body.source || 'demo'),
      limb: String(body.limb || patient.affectedSide || 'right'),
      durationSeconds: clampInt(body.durationSeconds, 0, 86400, 0),
      totalReps: clampInt(body.totalReps, 0, 100000, 0),
      correctReps: clampInt(body.correctReps, 0, 100000, 0),
      maxAchievedAngle: Number(body.maxAchievedAngle) || 0,
      compensationErrors: clampInt(body.compensationErrors, 0, 100000, 0),
      gamificationScore: clampInt(body.gamificationScore, 0, 1000000, 0),
      angleTimeline: Array.isArray(body.angleTimeline)
        ? JSON.stringify(body.angleTimeline.slice(0, 5000))
        : null,
    },
  })

  // Gamification: award any newly-earned badges for this patient.
  const newBadges = await awardBadges(body.patientId)

  // Update the streak tracker + emit milestone notifications.
  const { updateStreakOnSession } = await import('@/lib/streaks')
  const streakInfo = await updateStreakOnSession(body.patientId, session.sessionDate)

  // Update any unachieved goals whose currentValue this session improves.
  const { updateGoalsOnSession } = await import('@/lib/goals')
  const goalResults = await updateGoalsOnSession(body.patientId, session)

  // Emit a session-saved notification + badge-earned notifications.
  const { createNotification, notifyBadgesEarned } = await import('@/lib/notifications')
  await createNotification({
    userId: body.patientId,
    type: 'session_saved',
    title: 'Session saved',
    body: `${session.totalReps} reps, ${session.maxAchievedAngle.toFixed(0)}° max ROM, score ${session.gamificationScore}.`,
    severity: 'success',
    linkType: 'session',
    linkId: session.id,
  })
  if (newBadges.length > 0) {
    await notifyBadgesEarned(body.patientId, newBadges.map((b) => b.slug))
  }

  return NextResponse.json({ ok: true, session, newBadges, streak: streakInfo, goalAchievements: goalResults.achieved })
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : def
  if (!Number.isFinite(n)) return def
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
