import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'

// GET /api/v2/patients?role=PATIENT
// - Doctors see ALL patients.
// - Patients see only themselves.
// Each patient row includes their latest session summary + active plan.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }

  const isDoctor = requireRole(payload, 'DOCTOR') || requireRole(payload, 'ADMIN')

  // For a doctor: list every patient with their latest session + plan counts.
  // For a patient: only their own row.
  const users = await db.user.findMany({
    where: isDoctor
      ? { role: 'PATIENT' }
      : { id: payload.sub, role: 'PATIENT' },
    select: {
      id: true,
      name: true,
      email: true,
      avatarSeed: true,
      affectedSide: true,
      dateOfBirth: true,
      createdAt: true,
      _count: { select: { sessions: true, plans: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Enrich with latest-session aggregate per patient (one query, then group in JS).
  const patientIds = users.map((u) => u.id)
  const latestSessions = patientIds.length
    ? await db.rehabSession.findMany({
        where: { patientId: { in: patientIds } },
        orderBy: { sessionDate: 'desc' },
        select: {
          patientId: true,
          sessionDate: true,
          totalReps: true,
          correctReps: true,
          gamificationScore: true,
          maxAchievedAngle: true,
          compensationErrors: true,
        },
        // We can't easily do "first per patient" in Prisma without raw SQL,
        // so we pull recent sessions and group in JS.
        take: 200,
      })
    : []

  const latestByPatient = new Map<string, (typeof latestSessions)[number]>()
  for (const s of latestSessions) {
    if (!latestByPatient.has(s.patientId)) latestByPatient.set(s.patientId, s)
  }

  return NextResponse.json({
    ok: true,
    isDoctor,
    patients: users.map((u) => {
      const latest = latestByPatient.get(u.id)
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        avatarSeed: u.avatarSeed,
        affectedSide: u.affectedSide,
        dateOfBirth: u.dateOfBirth,
        createdAt: u.createdAt,
        sessionsCount: u._count.sessions,
        plansCount: u._count.plans,
        latestSession: latest
          ? {
              sessionDate: latest.sessionDate,
              totalReps: latest.totalReps,
              correctReps: latest.correctReps,
              gamificationScore: latest.gamificationScore,
              maxAchievedAngle: latest.maxAchievedAngle,
              compensationErrors: latest.compensationErrors,
            }
          : null,
      }
    }),
  })
}
