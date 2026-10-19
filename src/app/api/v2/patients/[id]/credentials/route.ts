import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, hashPassword } from '@/lib/auth'
import { canAccessPatient, isStaff } from '@/lib/access'
import { audit } from '@/lib/audit'
import { issueLoginToken, newPin } from '@/lib/patient-accounts'

// POST /api/v2/patients/[id]/credentials — the patient's doctor manages how they sign in.
// Body: { action: 'reset-pin' | 'qr' | 'remove-passkeys' | 'deactivate' | 'activate' }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const { id } = await ctx.params
  if (!isStaff(payload) || !(await canAccessPatient(payload, id))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  switch (body?.action) {
    case 'reset-pin': {
      const pin = newPin()
      await db.user.update({ where: { id }, data: { pinHash: hashPassword(pin) } })
      await db.authAttempt.deleteMany({ where: { key: { in: await accountKeys(id) } } })
      await audit(req, { actorId: payload.sub, action: 'pin_reset', patientId: id })
      return NextResponse.json({ ok: true, pin })
    }
    case 'qr': {
      const qr = await issueLoginToken(id, payload.sub)
      await audit(req, { actorId: payload.sub, action: 'qr_issued', patientId: id })
      return NextResponse.json({ ok: true, qrToken: qr.token, qrExpiresAt: qr.expiresAt })
    }
    case 'remove-passkeys': {
      const { count } = await db.passkey.deleteMany({ where: { userId: id } })
      await audit(req, { actorId: payload.sub, action: 'passkey_removed', patientId: id, detail: `${count} removed by doctor` })
      return NextResponse.json({ ok: true, removed: count })
    }
    case 'deactivate':
    case 'activate': {
      await db.user.update({ where: { id }, data: { active: body.action === 'activate' } })
      if (body.action === 'deactivate') await db.loginToken.deleteMany({ where: { userId: id, usedAt: null } })
      await audit(req, { actorId: payload.sub, action: 'patient_updated', patientId: id, detail: body.action })
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
  }
}

/** The lockout keys of this patient's sign-in names, so a new PIN works at once. */
async function accountKeys(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { username: true, email: true } })
  return [u?.username, u?.email].filter(Boolean).map((v) => `acct:${v}`)
}
