import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canAccessPatient, isAdmin, isStaff } from '@/lib/access'
import { audit } from '@/lib/audit'
import { PATIENT_EMAIL_DOMAIN } from '@/lib/patient-accounts'

// GET /api/v2/patients/[id]: patient profile + active plan + recent sessions.
// The patient's own doctor (or an admin) and the patient themselves.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await ctx.params
  const isDoctor = isStaff(payload)
  if (!(await canAccessPatient(payload, id))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (isDoctor) await audit(req, { actorId: payload.sub, action: 'patient_viewed', patientId: id })

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
      username: true,
      active: true,
      archivedAt: true,
      consentSignedAt: true,
      patientConsentAt: true,
      _count: { select: { passkeys: true } },
    },
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  const [activePlan, recentSessions, earnedBadges] = await Promise.all([
    db.treatmentPlan.findFirst({
      where: { patientId: id, active: true },
      orderBy: { createdAt: 'desc' },
      include: { doctor: { select: { id: true, name: true } } },
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
    patient: { ...user, email: user.email.endsWith(`@${PATIENT_EMAIL_DOMAIN}`) ? "" : user.email, passkeys: user._count.passkeys },
    activePlan,
    sessions: recentSessions,
    earnedBadges,
    aggregate,
    isDoctor,
  })
}

// DELETE /api/v2/patients/[id]: erase an archived patient and all their records, for good.
// Admins only; body { confirmName } must match the patient's name. The access log keeps an entry
// that a patient was erased (without the name).
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  if (!isAdmin(payload)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const patient = await db.user.findUnique({ where: { id }, select: { role: true, name: true, archivedAt: true } })
  if (!patient || patient.role !== 'PATIENT') return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  if (!patient.archivedAt) return NextResponse.json({ ok: false, error: 'archive the patient first' }, { status: 409 })
  if (String(body?.confirmName ?? '').trim() !== patient.name.trim()) {
    return NextResponse.json({ ok: false, error: 'name does not match' }, { status: 400 })
  }
  await db.$transaction([
    // Records without a database link to the patient; the rest go with the patient (cascade).
    db.chatMessage.deleteMany({ where: { OR: [{ patientId: id }, { speakerId: id }] } }),
    db.notification.deleteMany({ where: { userId: id } }),
    db.streak.deleteMany({ where: { userId: id } }),
    db.rehabGoal.deleteMany({ where: { patientId: id } }),
    db.loginToken.deleteMany({ where: { userId: id } }),
    db.user.delete({ where: { id } }),
  ])
  await audit(req, { actorId: payload.sub, action: 'patient_deleted', patientId: id })
  return NextResponse.json({ ok: true })
}
