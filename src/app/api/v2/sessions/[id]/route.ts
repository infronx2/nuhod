import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/sessions/[id] — full session record (including the angleTimeline
 * JSON for the replay visualizer).
 *
 * Auth: the patient who owns the session, or any doctor/admin.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await ctx.params

  const session = await db.rehabSession.findUnique({
    where: { id },
    include: { patient: { select: { name: true, email: true, affectedSide: true } } },
  })
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }

  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  if (!isDoctor && payload.sub !== session.patientId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    ok: true,
    session: {
      id: session.id,
      patientId: session.patientId,
      planId: session.planId,
      source: session.source,
      limb: session.limb,
      sessionDate: session.sessionDate,
      durationSeconds: session.durationSeconds,
      totalReps: session.totalReps,
      correctReps: session.correctReps,
      maxAchievedAngle: session.maxAchievedAngle,
      compensationErrors: session.compensationErrors,
      gamificationScore: session.gamificationScore,
      angleTimeline: session.angleTimeline,
      createdAt: session.createdAt,
      patient: session.patient,
    },
  })
}
