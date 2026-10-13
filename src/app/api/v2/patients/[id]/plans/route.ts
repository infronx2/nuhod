import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'

// POST /api/v2/patients/[id]/plans — doctor creates a treatment plan for a patient.
// Body: { title?, targetLimb?, targetAngle?, sessionsPerWeek?, dailyRepGoal?, notes? }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!requireRole(payload, 'DOCTOR') && !requireRole(payload, 'ADMIN')) {
    return NextResponse.json({ ok: false, error: 'forbidden — doctors only' }, { status: 403 })
  }
  const { id: patientId } = await ctx.params

  const patient = await db.user.findUnique({ where: { id: patientId } })
  if (!patient || patient.role !== 'PATIENT') {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine — use defaults */
  }

  const targetLimb = String(body.targetLimb || patient.affectedSide === 'left' ? 'upper_left' : 'upper_right')
  const plan = await db.treatmentPlan.create({
    data: {
      patientId,
      doctorId: payload.sub,
      title: String(body.title || 'Upper-limb rehab plan'),
      targetLimb,
      targetAngle: clampInt(body.targetAngle, 0, 180, 90),
      sessionsPerWeek: clampInt(body.sessionsPerWeek, 1, 14, 5),
      dailyRepGoal: clampInt(body.dailyRepGoal, 1, 200, 20),
      notes: body.notes ? String(body.notes).slice(0, 1000) : null,
      // Deactivate previous active plans for this patient so only one is live.
    },
  })
  await db.treatmentPlan.updateMany({
    where: { patientId, id: { not: plan.id }, active: true },
    data: { active: false },
  })

  // Notify the patient about the new plan.
  const { notifyPlanPrescribed } = await import('@/lib/notifications')
  await notifyPlanPrescribed(patientId, plan.title, plan.targetAngle)

  return NextResponse.json({ ok: true, plan })
}

// GET /api/v2/patients/[id]/plans — list a patient's plans (history).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const { id: patientId } = await ctx.params
  const isDoctor = requireRole(payload, 'DOCTOR') || requireRole(payload, 'ADMIN')
  if (!isDoctor && payload.sub !== patientId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const plans = await db.treatmentPlan.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: { doctor: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ ok: true, plans })
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === 'number' ? v : def
  if (!Number.isFinite(n)) return def
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
