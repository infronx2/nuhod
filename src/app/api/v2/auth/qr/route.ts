import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { audit, clientIp } from '@/lib/audit'
import { addressKey, lockedMinutes, recordFailure } from '@/lib/rate-limit'
import { hashToken, signInResponse } from '@/lib/patient-accounts'

// POST /api/v2/auth/qr. Body: { token } from the QR code the doctor showed. Single use, 24 hours.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const address = addressKey(clientIp(req))
  if ((await lockedMinutes(null, address)) > 0) {
    return NextResponse.json({ ok: false, error: 'too many attempts' }, { status: 429 })
  }
  const row = token ? await db.loginToken.findUnique({ where: { tokenHash: hashToken(token) } }) : null
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    await recordFailure([address])
    return NextResponse.json({ ok: false, error: row ? 'code expired or used' : 'invalid code' }, { status: 401 })
  }
  // Claim it atomically so two scans cannot both sign in.
  const claimed = await db.loginToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
  const user = await db.user.findUnique({ where: { id: row.userId } })
  if (claimed.count !== 1 || !user || !user.active) {
    return NextResponse.json({ ok: false, error: 'code expired or used' }, { status: 401 })
  }
  await audit(req, { actorId: user.id, action: 'login_qr', patientId: user.id })
  return NextResponse.json(signInResponse(user))
}
