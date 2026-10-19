import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth'
import { audit, clientIp } from '@/lib/audit'
import { accountKey, addressKey, clearFailures, clearLastAttempt, lockedMinutes, recordFailure } from '@/lib/rate-limit'
import { signInResponse } from '@/lib/patient-accounts'

// POST /api/v2/auth/login
// Body: { email, password }. "email" may also be a patient's username and "password" their PIN,
// which is what the clinic game sends when a patient types them into its sign-in screen.
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const identifier = String(body.email || body.username || '').trim().toLowerCase()
  const secret = String(body.password || body.pin || '')

  if (!identifier || !secret) {
    return NextResponse.json({ ok: false, error: 'email and password are required' }, { status: 400 })
  }

  const user = identifier.includes('@')
    ? await db.user.findUnique({ where: { email: identifier } })
    : await db.user.findUnique({ where: { username: identifier } })
  // One lockout per account (username and email share it), counted before the check so parallel
  // guesses cannot all slip in before the first failure is recorded.
  const account = accountKey(user?.id ?? identifier)
  const address = addressKey(clientIp(req))
  await recordFailure([account, address])
  const wait = await lockedMinutes(account, address, 1)
  if (wait > 0) {
    await audit(req, { actorId: user?.id, action: 'login_locked', patientId: user?.role === 'PATIENT' ? user.id : null })
    return NextResponse.json({ ok: false, error: 'too many attempts', retryAfterMinutes: wait }, { status: 429 })
  }

  const ok = !!user && (verifyPassword(secret, user.passwordHash) || verifyPassword(secret, user.pinHash))
  if (!user || !ok) {
    await audit(req, { actorId: user?.id, action: 'login_failed', patientId: user?.role === 'PATIENT' ? user.id : null })
    return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 })
  }
  if (!user.active) {
    return NextResponse.json({ ok: false, error: 'account disabled' }, { status: 403 })
  }

  await clearFailures(account)
  await clearLastAttempt(address)
  await audit(req, { actorId: user.id, action: 'login', patientId: user.role === 'PATIENT' ? user.id : null })
  return NextResponse.json(signInResponse(user))
}
