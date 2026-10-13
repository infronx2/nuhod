import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'

/**
 * GET /api/v2/goals?patientId=X — list a patient's goals (achieved + active).
 * Doctors can query any patient; patients get only their own.
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const patientId = url.searchParams.get('patientId')
  const isDoctor = requireRole(payload, 'DOCTOR') || requireRole(payload, 'ADMIN')
  const targetPatient = patientId
    ? isDoctor || patientId === payload.sub
      ? patientId
      : payload.sub
    : payload.sub

  const goals = await db.rehabGoal.findMany({
    where: { patientId: targetPatient },
    orderBy: [{ achieved: 'asc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json({ ok: true, goals })
}

/**
 * POST /api/v2/goals — doctor creates a new goal for a patient.
 * Body: { patientId, type, title, targetValue, targetDate? }
 */
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!requireRole(payload, 'DOCTOR') && !requireRole(payload, 'ADMIN')) {
    return NextResponse.json({ ok: false, error: 'forbidden — doctors only' }, { status: 403 })
  }
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const patientId = String(body.patientId || '')
  if (!patientId) {
    return NextResponse.json({ ok: false, error: 'patientId is required' }, { status: 400 })
  }
  const validTypes = ['rom_target', 'rep_count', 'accuracy', 'streak']
  const type = validTypes.includes(body.type) ? body.type : 'rom_target'
  const targetValue = Number(body.targetValue)
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    return NextResponse.json({ ok: false, error: 'targetValue must be a positive number' }, { status: 400 })
  }

  const goal = await db.rehabGoal.create({
    data: {
      patientId,
      type,
      title: String(body.title || `Reach ${targetValue}${type === 'rom_target' ? '°' : ''}`),
      targetValue,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
    },
  })

  // Notify the patient about the new goal.
  const { createNotification } = await import('@/lib/notifications')
  await createNotification({
    userId: patientId,
    type: 'goal_achieved',
    title: 'New goal set',
    body: `Your clinician set a new goal: "${goal.title}" — target ${targetValue}.`,
    severity: 'info',
    linkType: 'goal',
    linkId: goal.id,
  })

  return NextResponse.json({ ok: true, goal })
}
