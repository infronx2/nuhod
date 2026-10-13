import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'

// GET /api/v2/patients/[id] — patient profile + active plan + recent sessions.
// Doctors can read any patient; patients can read only their own profile.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await ctx.params
  const isDoctor = requireRole(payload, 'DOCTOR') || requireRole(payload, 'ADMIN')
  if (!isDoctor && payload.sub !== id) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarSeed: true,
      affectedSide: true,
      dateOfBirth: true,
      preferredDialect: true,
      createdAt: true,
    },
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  const [activePlan, recentSessions, earnedBadges] = await Promise.all([
    db.treatmentPlan.findFirst({
      where: { patientId: id, active: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.rehabSession.findMany({
      where: { patientId: id },
      orderBy: { sessionDate: 'desc' },
      take: 50,
    }),
    db.earnedBadge.findMany({
      where: { userId: id },
      orderBy: { earnedAt: 'desc' },
    }),
  ])

  // Aggregate clinical progress over the last 30 sessions.
  const last30 = recentSessions.slice(0, 30)
  const aggregate = last30.length
    ? {
        totalSessions: recentSessions.length,
        windowSessions: last30.length,
        totalReps: last30.reduce((s, x) => s + x.totalReps, 0),
        totalCorrectReps: last30.reduce((s, x) => s + x.correctReps, 0),
        totalScore: last30.reduce((s, x) => s + x.gamificationScore, 0),
        maxAngleOverall: last30.reduce((m, x) => Math.max(m, x.maxAchievedAngle), 0),
        avgCompensationErrors:
          last30.reduce((s, x) => s + x.compensationErrors, 0) / last30.length,
        accuracyPct:
          last30.reduce((s, x) => s + x.totalReps, 0) > 0
            ? (last30.reduce((s, x) => s + x.correctReps, 0) /
                last30.reduce((s, x) => s + x.totalReps, 0)) *
              100
            : 0,
      }
    : {
        totalSessions: 0,
        windowSessions: 0,
        totalReps: 0,
        totalCorrectReps: 0,
        totalScore: 0,
        maxAngleOverall: 0,
        avgCompensationErrors: 0,
        accuracyPct: 0,
      }

  return NextResponse.json({
    ok: true,
    patient: user,
    activePlan,
    sessions: recentSessions,
    earnedBadges,
    aggregate,
    isDoctor,
  })
}
