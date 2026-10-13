import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { signToken, verifyPassword } from '@/lib/auth'

// POST /api/v2/auth/login
// Body: { email, password }
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: 'email and password are required' },
      { status: 400 },
    )
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash) {
    return NextResponse.json(
      { ok: false, error: 'invalid credentials' },
      { status: 401 },
    )
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { ok: false, error: 'invalid credentials' },
      { status: 401 },
    )
  }
  if (!user.active) {
    return NextResponse.json(
      { ok: false, error: 'account disabled' },
      { status: 403 },
    )
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
      preferredDialect: user.preferredDialect,
      affectedSide: user.affectedSide,
    },
  })
}
