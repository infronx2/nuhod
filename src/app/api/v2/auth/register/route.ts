import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { signToken, hashPassword } from '@/lib/auth'
import { DEFAULT_PLAN, createDefaultPlan, parseSide } from '@/lib/plans'

// POST /api/v2/auth/register
// Body: { email, name, password, role?: "PATIENT"|"DOCTOR", affectedSide?: "right"|"left"|"bilateral",
//         inviteCode? (doctors only) }
// A patient gets a starter treatment plan right away, so they can play before a doctor sees them.
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const email = String(body.email || '').trim().toLowerCase()
  const name = String(body.name || '').trim()
  const password = String(body.password || '')
  const role = String(body.role || 'PATIENT').toUpperCase() === 'DOCTOR' ? 'DOCTOR' : 'PATIENT'
  const affectedSide = parseSide(body.affectedSide) ?? 'right'

  if (!email || !name || !password) {
    return NextResponse.json(
      { ok: false, error: 'email, name and password are required' },
      { status: 400 },
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, error: 'password must be at least 6 characters' },
      { status: 400 },
    )
  }

  // A doctor sees every patient's records, so doctor sign-up needs the clinic's invite code.
  if (role === 'DOCTOR') {
    const invite = process.env.NUHOUD_DOCTOR_INVITE_CODE
    if (!invite || String(body.inviteCode || '').trim() !== invite) {
      return NextResponse.json(
        { ok: false, error: 'doctor accounts need the clinic invite code' },
        { status: 403 },
      )
    }
  }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json(
      { ok: false, error: 'email already registered' },
      { status: 409 },
    )
  }

  const avatarSeed = hashEmailToColor(email)

  const user = await db.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: hashPassword(password),
      avatarSeed,
      ...(role === 'PATIENT' ? { affectedSide } : {}),
    },
  })

  if (role === 'PATIENT') {
    try {
      const created = await createDefaultPlan(user)
      if (created) {
        const { createNotification } = await import('@/lib/notifications')
        await createNotification({
          userId: created.doctor.id,
          type: 'info',
          title: `New patient: ${user.name}`,
          body: `Starter plan: ${DEFAULT_PLAN.targetAngle}° target, ${DEFAULT_PLAN.dailyRepGoal} tasks a day. Review it in the roster.`,
          severity: 'info',
          linkType: 'patient',
          linkId: user.id,
        })
      }
    } catch (err) {
      // The account exists either way; the doctor can still prescribe a plan by hand.
      console.error('[register] starter plan failed', err)
    }
  }

  const token = signToken({
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  })

  return NextResponse.json({
    ok: true,
    token,
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      avatarSeed: user.avatarSeed,
      affectedSide: user.affectedSide,
    },
  })
}

function hashEmailToColor(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  const palette = ['14b8a6', 'f59e0b', 'f43f5e', '10b981', 'a855f7', 'ec4899', '06b6d4', '84cc16']
  return palette[h % palette.length]
}
