import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

// GET /api/v2/auth/me — returns the current authenticated user.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const user = await db.user.findUnique({ where: { id: payload.sub } })
  if (!user || !user.active) {
    return NextResponse.json({ ok: false, error: 'user not found' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      avatarSeed: user.avatarSeed,
      preferredDialect: user.preferredDialect,
      affectedSide: user.affectedSide,
      dateOfBirth: user.dateOfBirth,
    },
  })
}
