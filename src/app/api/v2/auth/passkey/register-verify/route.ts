import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { readChallenge, relyingParty } from '@/lib/passkeys'

// POST /api/v2/auth/passkey/register-verify. Body: { response, challengeToken, deviceLabel? }
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const challenge = readChallenge(body?.challengeToken, 'register')
  if (!challenge || challenge.userId !== payload.sub || !body?.response) {
    return NextResponse.json({ ok: false, error: 'expired, try again' }, { status: 400 })
  }
  const { rpID, origin } = relyingParty(req)
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'verification failed' }, { status: 400 })
  }
  if (!verification.verified) return NextResponse.json({ ok: false, error: 'verification failed' }, { status: 400 })
  const { credential } = verification.registrationInfo
  await db.passkey.upsert({
    where: { credentialId: credential.id },
    create: {
      userId: payload.sub, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      deviceLabel: typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 60) : null,
    },
    update: {},
  })
  await audit(req, { actorId: payload.sub, action: 'passkey_added', patientId: payload.role === 'PATIENT' ? payload.sub : null })
  return NextResponse.json({ ok: true })
}
