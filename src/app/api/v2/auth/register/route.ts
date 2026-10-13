import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { signToken, hashPassword } from '@/lib/auth'

// POST /api/v2/auth/register
// Body: { email, name, password, role?: "PATIENT"|"DOCTOR" }
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
    },
  })

  const token = signToken({
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  })

  return NextResponse.json({
    ok: true,
    token,
    user: { id: user.id, role: user.role, email: user.email, name: user.name, avatarSeed: user.avatarSeed },
  })
}

function hashEmailToColor(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  const palette = ['14b8a6', 'f59e0b', 'f43f5e', '10b981', 'a855f7', 'ec4899', '06b6d4', '84cc16']
  return palette[h % palette.length]
}
