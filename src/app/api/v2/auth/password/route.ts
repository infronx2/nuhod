import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, hashPassword, verifyPassword } from '@/lib/auth'

// POST /api/v2/auth/password: the signed-in user changes their own password.
// Body: { currentPassword, newPassword }
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const currentPassword = String(body?.currentPassword || '')
  const newPassword = String(body?.newPassword || '')
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: 'new password must be at least 8 characters' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { id: payload.sub } })
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ ok: false, error: 'current password is wrong' }, { status: 403 })
  }

  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } })
  return NextResponse.json({ ok: true })
}
