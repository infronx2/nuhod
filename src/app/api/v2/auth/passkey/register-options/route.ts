import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { challengeToken, relyingParty, RP_NAME } from '@/lib/passkeys'

// POST /api/v2/auth/passkey/register-options: signed in; starts adding Face ID / fingerprint.
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const user = await db.user.findUnique({ where: { id: payload.sub }, include: { passkeys: true } })
  if (!user || !user.active) return NextResponse.json({ ok: false, error: 'user not found' }, { status: 404 })
  const { rpID } = relyingParty(req)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.username || user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    // A discoverable credential lets the patient sign in later without typing a username.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  return NextResponse.json({ ok: true, options, challengeToken: challengeToken(options.challenge, 'register', user.id) })
}
