import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/stats/distribution?patientId=X
 *
 * Returns an accuracy distribution histogram (how many sessions fall into
 * each 20%-wide bucket: 0-20, 20-40, ..., 80-100) plus a plan-adherence
 * gauge (sessions done this week vs the plan's sessionsPerWeek target).
 *
 * Doctors can query any patientId or omit for a global aggregate. Patients
 * get only their own.
 *
 * Response:
 *   {
 *     ok: true,
 *     buckets: [{ label: "0-20%", min: 0, max: 20, count: 1 }, ...],
 *     adherence: { sessionsThisWeek: 3, targetPerWeek: 5, pct: 60 }
 *   }
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const patientIdParam = url.searchParams.get('patientId')

  let where: any
  if (patientIdParam) {
    if (isDoctor || patientIdParam === payload.sub) {
      where = { patientId: patientIdParam }
    } else {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
  } else if (isDoctor) {
    where = {}
  } else {
    where = { patientId: payload.sub }
  }

  // Fetch all sessions with the fields we need.
  const sessions = await db.rehabSession.findMany({
    where,
    select: {
      totalReps: true,
      correctReps: true,
      sessionDate: true,
      patientId: true,
    },
  })

  // Build the accuracy distribution (5 buckets of 20% each).
  const BUCKET_EDGES = [0, 20, 40, 60, 80, 100]
  const buckets = BUCKET_EDGES.slice(0, -1).map((min, i) => ({
    label: `${min}-${BUCKET_EDGES[i + 1]}%`,
    min,
    max: BUCKET_EDGES[i + 1],
    count: 0,
  }))

  for (const s of sessions) {
    if (s.totalReps === 0) continue
    const acc = (s.correctReps / s.totalReps) * 100
    let idx = Math.min(Math.floor(acc / 20), 4)
    if (idx < 0) idx = 0
    buckets[idx].count += 1
  }

  // Plan adherence: sessions in the last 7 days vs the active plan's
  // sessionsPerWeek target. For the global (doctor, no patientId) case,
  // we compute adherence per patient and average it.
  const now = new Date()
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)

  let adherence: { sessionsThisWeek: number; targetPerWeek: number; pct: number }
  if (patientIdParam) {
    const sessionsThisWeek = sessions.filter(
      (s) => s.sessionDate >= weekAgo && s.patientId === patientIdParam,
    ).length
    const plan = await db.treatmentPlan.findFirst({
      where: { patientId: patientIdParam, active: true },
      select: { sessionsPerWeek: true },
    })
    const target = plan?.sessionsPerWeek ?? 5
    adherence = {
      sessionsThisWeek,
      targetPerWeek: target,
      pct: target > 0 ? Math.min(100, Math.round((sessionsThisWeek / target) * 100)) : 0,
    }
  } else {
    // Global: average adherence across all patients with an active plan.
    const patients = await db.user.findMany({
      where: { role: 'PATIENT' },
      select: { id: true },
    })
    let totalPct = 0
    let counted = 0
    for (const p of patients) {
      const sw = sessions.filter(
        (s) => s.sessionDate >= weekAgo && s.patientId === p.id,
      ).length
      const plan = await db.treatmentPlan.findFirst({
        where: { patientId: p.id, active: true },
        select: { sessionsPerWeek: true },
      })
      if (plan) {
        totalPct += plan.sessionsPerWeek > 0 ? Math.min(100, (sw / plan.sessionsPerWeek) * 100) : 0
        counted += 1
      }
    }
    const sessionsThisWeek = sessions.filter((s) => s.sessionDate >= weekAgo).length
    adherence = {
      sessionsThisWeek,
      targetPerWeek: counted,
      pct: counted > 0 ? Math.round(totalPct / counted) : 0,
    }
  }

  return NextResponse.json({
    ok: true,
    buckets,
    adherence,
    totalSessions: sessions.length,
  })
}
