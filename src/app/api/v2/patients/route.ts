import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, hashPassword } from '@/lib/auth'
import { isStaff, staffPatientWhere } from '@/lib/access'
import { audit } from '@/lib/audit'
import { createDefaultPlan, parseSide } from '@/lib/plans'
import { CONSENT_VERSION, PATIENT_EMAIL_DOMAIN, USERNAME_RE, issueLoginToken, newPin, suggestUsername } from '@/lib/patient-accounts'

// Sessions per patient the roster indicators look at.
const RECENT_SESSIONS = 6

// GET /api/v2/patients?role=PATIENT
// - A doctor sees the patients they follow (an admin sees all).
// - Patients see only themselves.
// Each patient row includes their latest session summary, active plan, and progress indicators.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }

  const isDoctor = isStaff(payload)

  // For a doctor: list every patient with their latest session + plan counts.
  // For a patient: only their own row.
  const users = await db.user.findMany({
    where: isDoctor
      ? staffPatientWhere(payload)
      : { id: payload.sub, role: 'PATIENT' },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      active: true,
      avatarSeed: true,
      affectedSide: true,
      dateOfBirth: true,
      createdAt: true,
      _count: { select: { sessions: true, plans: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const patientIds = users.map((u) => u.id)
  const [recentSessions, activePlans] = patientIds.length
    ? await Promise.all([
        db.rehabSession.findMany({
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
            gripClosureMax: true,
            tasksAssisted: true,
            painStop: true,
          },
          take: 2000,
        }),
        db.treatmentPlan.findMany({
          where: { patientId: { in: patientIds }, active: true },
          orderBy: { createdAt: 'desc' },
          select: { patientId: true, targetAngle: true, dailyRepGoal: true, sessionsPerWeek: true, targetLimb: true, notes: true },
        }),
      ])
    : [[], []]

  const sessionsByPatient = new Map<string, (typeof recentSessions)[number][]>()
  for (const s of recentSessions) {
    const list = sessionsByPatient.get(s.patientId) ?? []
    if (list.length < RECENT_SESSIONS) list.push(s)
    sessionsByPatient.set(s.patientId, list)
  }
  const planByPatient = new Map<string, (typeof activePlans)[number]>()
  for (const p of activePlans) {
    if (!planByPatient.has(p.patientId)) planByPatient.set(p.patientId, p)
  }

  return NextResponse.json({
    ok: true,
    isDoctor,
    patients: users.map((u) => {
      const sessions = sessionsByPatient.get(u.id) ?? []
      const latest = sessions[0]
      const plan = planByPatient.get(u.id)
      return {
        id: u.id,
        name: u.name,
        email: u.email.endsWith(`@${PATIENT_EMAIL_DOMAIN}`) ? '' : u.email,
        username: u.username,
        active: u.active,
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
        activePlan: plan
          ? {
              targetAngle: plan.targetAngle,
              dailyRepGoal: plan.dailyRepGoal,
              sessionsPerWeek: plan.sessionsPerWeek,
              targetLimb: plan.targetLimb,
              notes: plan.notes,
            }
          : null,
        indicators: indicatorsFor(sessions),
      }
    }),
  })
}

// POST /api/v2/patients — a doctor adds a patient they will follow.
// Body: { name, affectedSide?, dateOfBirth?, username?, consentSigned: true, screening: { [item]: boolean } }
// Returns the username, a 6-digit PIN (shown once) and a one-time QR sign-in token.
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  if (!isStaff(payload)) return NextResponse.json({ ok: false, error: 'forbidden — doctors only' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const name = String(body?.name || '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 })
  if (body?.consentSigned !== true) {
    return NextResponse.json({ ok: false, error: 'written consent must be recorded first' }, { status: 400 })
  }
  const screening = body?.screening && typeof body.screening === 'object' ? body.screening : {}
  if (Object.values(screening).some((v) => v !== true)) {
    return NextResponse.json({ ok: false, error: 'every eligibility item must be confirmed' }, { status: 400 })
  }
  let username = String(body?.username || '').trim().toLowerCase()
  if (username && !USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: 'username: 3-24 English letters or digits, starting with a letter' }, { status: 400 })
  }
  if (username && (await db.user.findUnique({ where: { username }, select: { id: true } }))) {
    return NextResponse.json({ ok: false, error: 'username taken' }, { status: 409 })
  }
  if (!username) username = await suggestUsername()
  const dob = typeof body?.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth) ? body.dateOfBirth : null

  const pin = newPin()
  const user = await db.user.create({
    data: {
      role: 'PATIENT',
      name,
      username,
      email: `${username}@${PATIENT_EMAIL_DOMAIN}`,
      pinHash: hashPassword(pin),
      affectedSide: parseSide(body?.affectedSide) ?? 'right',
      dateOfBirth: dob,
      doctorId: payload.sub,
      consentSignedAt: new Date(),
      consentRecordedBy: payload.sub,
      consentVersion: CONSENT_VERSION,
      screening: JSON.stringify(screening),
    },
  })
  // The starter plan under this doctor, so the patient can play in the clinic and at home at once.
  const doctor = await db.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true } })
  try {
    await createDefaultPlan(user, doctor ?? undefined)
  } catch (err) {
    console.error('[patients] starter plan failed', err)
  }
  const qr = await issueLoginToken(user.id, payload.sub)
  await audit(req, { actorId: payload.sub, action: 'patient_created', patientId: user.id })
  return NextResponse.json({ ok: true, patient: { id: user.id, name: user.name, username }, pin, qrToken: qr.token, qrExpiresAt: qr.expiresAt })
}

type IndicatorSession = {
  maxAchievedAngle: number
  totalReps: number
  compensationErrors: number
  gripClosureMax: number
  tasksAssisted: number
  painStop: boolean
}

/**
 * Progress at a glance for the roster, from the most recent sessions (newest first):
 * - romTrend: degrees gained by the newer half of the sessions over the older half
 * - status: "attention" for any pain stop, or (from two sessions on) frequent compensation (web
 *   tracker) or assistance (majlis game), or a ROM drop of 5 degrees; "improving" for a gain of
 *   2 degrees; "new" with fewer than two sessions; otherwise "stable".
 */
function indicatorsFor(sessions: IndicatorSession[]) {
  const count = sessions.length
  const reps = sessions.reduce((s, x) => s + x.totalReps, 0)
  const compensationRate = reps > 0 ? sessions.reduce((s, x) => s + x.compensationErrors, 0) / reps : 0
  const assistedRate = reps > 0 ? sessions.reduce((s, x) => s + x.tasksAssisted, 0) / reps : 0
  const painStops = sessions.filter((x) => x.painStop).length
  const bestGrip = sessions.reduce((m, x) => Math.max(m, x.gripClosureMax), 0)

  let romTrend: number | null = null
  if (count >= 2) {
    const newer = sessions.slice(0, Math.floor(count / 2))
    const older = sessions.slice(Math.floor(count / 2))
    const mean = (xs: IndicatorSession[]) => xs.reduce((s, x) => s + x.maxAchievedAngle, 0) / xs.length
    romTrend = Math.round((mean(newer) - mean(older)) * 10) / 10
  }

  const status =
    painStops > 0
      ? 'attention'
      : count < 2
        ? 'new'
        : compensationRate >= 0.2 || assistedRate >= 0.5 || (romTrend !== null && romTrend <= -5)
          ? 'attention'
          : romTrend !== null && romTrend >= 2
            ? 'improving'
            : 'stable'

  return {
    status,
    romTrend,
    compensationRate: Math.round(compensationRate * 1000) / 1000,
    assistedRate: Math.round(assistedRate * 1000) / 1000,
    painStops,
    bestGrip: bestGrip > 0 ? Math.round(bestGrip) : null,
    recentSessions: count,
  }
}
