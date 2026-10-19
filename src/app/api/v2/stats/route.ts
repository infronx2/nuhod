import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canAccessPatient, isStaff, staffPatientIds, staffPatientWhere } from '@/lib/access'

// GET /api/v2/stats?patientId=...
// Aggregate clinical + gamification stats across persisted sessions.
// - Doctors can query any patientId (or omit for global stats).
// - Patients get only their own stats.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const patientId = url.searchParams.get('patientId')
  const isDoctor = isStaff(payload)

  const where =
    patientId && (await canAccessPatient(payload, patientId))
      ? { patientId }
      : isDoctor
        ? { patientId: { in: await staffPatientIds(payload) } }
        : { patientId: payload.sub }

  const sessions = await db.rehabSession.findMany({
    where,
    select: {
      totalReps: true,
      correctReps: true,
      gamificationScore: true,
      compensationErrors: true,
      maxAchievedAngle: true,
      avgShoulderAngle: true,
      maxElbowROM: true,
      gripClosureMax: true,
      pinchMinCm: true,
      graspCount: true,
      pinchCount: true,
      tasksAssisted: true,
      painStop: true,
      durationSeconds: true,
      sessionDate: true,
    },
  })

  const totalReps = sessions.reduce((s, x) => s + x.totalReps, 0)
  const totalCorrect = sessions.reduce((s, x) => s + x.correctReps, 0)
  const totalScore = sessions.reduce((s, x) => s + x.gamificationScore, 0)
  const totalCompErrors = sessions.reduce((s, x) => s + x.compensationErrors, 0)
  const totalDuration = sessions.reduce((s, x) => s + x.durationSeconds, 0)
  const maxAngle = sessions.reduce((m, x) => Math.max(m, x.maxAchievedAngle), 0)
  const maxElbowROM = sessions.reduce((m, x) => Math.max(m, x.maxElbowROM), 0)
  const avgShoulderAngle = sessions.length > 0
    ? sessions.reduce((s, x) => s + x.avgShoulderAngle, 0) / sessions.length
    : 0
  const bestGripClosure = sessions.reduce((m, x) => Math.max(m, x.gripClosureMax), 0)
  const pinches = sessions.map((x) => x.pinchMinCm).filter((v) => v > 0)
  const bestPinchCm = pinches.length > 0 ? Math.min(...pinches) : 0
  const totalGrasps = sessions.reduce((s, x) => s + x.graspCount, 0)
  const totalPinches = sessions.reduce((s, x) => s + x.pinchCount, 0)
  const totalAssisted = sessions.reduce((s, x) => s + x.tasksAssisted, 0)
  const painStops = sessions.filter((x) => x.painStop).length
  const distinctDays = new Set(
    sessions.map((s) => new Date(s.sessionDate).toISOString().slice(0, 10)),
  ).size

  // 7-day activity series (reps per day) for the progress chart.
  const last7 = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    last7.set(d.toISOString().slice(0, 10), 0)
  }
  for (const s of sessions) {
    const k = new Date(s.sessionDate).toISOString().slice(0, 10)
    if (last7.has(k)) last7.set(k, (last7.get(k) || 0) + s.totalReps)
  }

  return NextResponse.json({
    ok: true,
    count: sessions.length,
    totalReps,
    totalCorrectReps: totalCorrect,
    totalScore,
    totalCompErrors,
    totalDurationSeconds: totalDuration,
    maxAngleOverall: maxAngle,
    maxElbowROM,
    avgShoulderAngle: Math.round(avgShoulderAngle * 10) / 10,
    bestGripClosure: Math.round(bestGripClosure),
    bestPinchCm: Math.round(bestPinchCm * 10) / 10,
    totalGrasps,
    totalPinches,
    totalAssisted,
    painStops,
    distinctDays,
    accuracyPct: totalReps > 0 ? Math.round((totalCorrect / totalReps) * 10000) / 100 : 0,
    activity7d: Array.from(last7.entries()).map(([day, reps]) => ({ day, reps })),
  })
}
