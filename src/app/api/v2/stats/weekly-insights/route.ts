import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/stats/weekly-insights?patientId=X
 *
 * Generates a weekly recap: this week's reps/sessions/accuracy vs last week,
 * the streak state, the best session, and a coach-style recommendation
 * string (computed, not LLM — fast and deterministic).
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const patientIdParam = url.searchParams.get('patientId')
  const targetPatient =
    patientIdParam && (isDoctor || patientIdParam === payload.sub)
      ? patientIdParam
      : payload.sub

  const now = new Date()
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const twoWeeksAgo = new Date(now)
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

  const [thisWeek, lastWeek, streak, activePlan] = await Promise.all([
    db.rehabSession.findMany({
      where: { patientId: targetPatient, sessionDate: { gte: weekAgo } },
      select: { totalReps: true, correctReps: true, maxAchievedAngle: true, compensationErrors: true, gamificationScore: true, sessionDate: true },
    }),
    db.rehabSession.findMany({
      where: { patientId: targetPatient, sessionDate: { gte: twoWeeksAgo, lt: weekAgo } },
      select: { totalReps: true, correctReps: true, maxAchievedAngle: true, compensationErrors: true, gamificationScore: true, sessionDate: true },
    }),
    db.streak.findUnique({ where: { userId: targetPatient } }),
    db.treatmentPlan.findFirst({
      where: { patientId: targetPatient, active: true },
      select: { targetAngle: true, dailyRepGoal: true, sessionsPerWeek: true },
    }),
  ])

  const sum = (arr: typeof thisWeek, key: keyof (typeof thisWeek)[number]) =>
    arr.reduce((s, x) => s + (x[key] as number), 0)

  const thisReps = sum(thisWeek, 'totalReps')
  const lastReps = sum(lastWeek, 'totalReps')
  const thisCorrect = sum(thisWeek, 'correctReps')
  const lastCorrect = sum(lastWeek, 'correctReps')
  const thisAcc = thisReps > 0 ? (thisCorrect / thisReps) * 100 : 0
  const lastAcc = lastReps > 0 ? (lastCorrect / lastReps) * 100 : 0
  const repsDelta = thisReps - lastReps
  const accDelta = thisAcc - lastAcc
  const bestSession = thisWeek.length
    ? thisWeek.reduce((best, s) => (s.maxAchievedAngle > best.maxAchievedAngle ? s : best))
    : null
  const totalScore = sum(thisWeek, 'gamificationScore')
  const compErrors = sum(thisWeek, 'compensationErrors')

  // Compute a coach-style recommendation (deterministic, no LLM).
  let recommendation: string
  if (thisWeek.length === 0) {
    recommendation = activePlan
      ? `No sessions this week — your plan calls for ${activePlan.sessionsPerWeek} sessions. Even 5 minutes today keeps the streak alive!`
      : 'No sessions this week. Start with a short 5-minute gentle flexion to warm up.'
  } else if (compErrors > thisWeek.length * 2) {
    recommendation = `You're averaging ${(compErrors / thisWeek.length).toFixed(1)} compensation errors per session — above the clinical threshold of 2. Focus on slow, controlled movements and avoid shrugging your shoulder. Consider lowering the target angle temporarily.`
  } else if (repsDelta > 0 && accDelta >= 0) {
    recommendation = `Great progress! You did ${repsDelta > 0 ? '+' : ''}${repsDelta} reps vs last week with ${accDelta >= 0 ? '+' : ''}${accDelta.toFixed(0)}% accuracy. You're trending up — keep the momentum going!`
  } else if (thisAcc >= 85) {
    recommendation = `Excellent accuracy at ${thisAcc.toFixed(0)}%! You're ready to increase the target angle by 10-15° for more challenge.`
  } else {
    recommendation = `Solid week — ${thisReps} reps across ${thisWeek.length} sessions. Aim for ${activePlan?.dailyRepGoal ?? 20} reps/day to hit your weekly goal.`
  }

  return NextResponse.json({
    ok: true,
    insights: {
      thisWeek: {
        sessions: thisWeek.length,
        reps: thisReps,
        accuracy: Math.round(thisAcc * 10) / 10,
        maxAngle: bestSession?.maxAchievedAngle ?? 0,
        score: totalScore,
        compErrors,
      },
      lastWeek: {
        sessions: lastWeek.length,
        reps: lastReps,
      },
      deltas: {
        reps: repsDelta,
        accuracy: Math.round(accDelta * 10) / 10,
      },
      streak: streak
        ? { current: streak.currentStreak, longest: streak.longestStreak, freezesLeft: streak.freezesLeft }
        : { current: 0, longest: 0, freezesLeft: 2 },
      bestSession: bestSession
        ? { date: bestSession.sessionDate.toISOString(), maxAngle: bestSession.maxAchievedAngle, reps: bestSession.totalReps }
        : null,
      recommendation,
    },
  })
}
