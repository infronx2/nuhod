import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { audit } from '@/lib/audit'

// GET /api/v2/auth/passkeys: the caller's own passkeys. DELETE ?id= removes one (lost phone).
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const passkeys = await db.passkey.findMany({
    where: { userId: payload.sub }, orderBy: { createdAt: 'desc' },
    select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
  })
  return NextResponse.json({ ok: true, passkeys })
}

export async function DELETE(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  const { count } = await db.passkey.deleteMany({ where: { id, userId: payload.sub } })
  if (count) await audit(req, { actorId: payload.sub, action: 'passkey_removed', patientId: payload.role === 'PATIENT' ? payload.sub : null })
  return NextResponse.json({ ok: true, removed: count })
}
