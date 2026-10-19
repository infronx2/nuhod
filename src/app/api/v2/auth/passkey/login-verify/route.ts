import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { db } from '@/lib/db'
import { audit, clientIp } from '@/lib/audit'
import { addressKey, lockedMinutes, recordFailure } from '@/lib/rate-limit'
import { readChallenge, relyingParty } from '@/lib/passkeys'
import { signInResponse } from '@/lib/patient-accounts'

// POST /api/v2/auth/passkey/login-verify — Body: { response, challengeToken }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const address = addressKey(clientIp(req))
  if ((await lockedMinutes(null, address)) > 0) {
    return NextResponse.json({ ok: false, error: 'too many attempts' }, { status: 429 })
  }
  const challenge = readChallenge(body?.challengeToken, 'login')
  const credentialId = typeof body?.response?.id === 'string' ? body.response.id : ''
  if (!challenge || !credentialId) return NextResponse.json({ ok: false, error: 'expired, try again' }, { status: 400 })
  const passkey = await db.passkey.findUnique({ where: { credentialId }, include: { user: true } })
  if (!passkey || !passkey.user.active) {
    await recordFailure([address])
    return NextResponse.json({ ok: false, error: 'unknown passkey' }, { status: 401 })
  }
  const { rpID, origin } = relyingParty(req)
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    })
  } catch {
    verification = null
  }
  if (!verification?.verified) {
    await recordFailure([address])
    return NextResponse.json({ ok: false, error: 'verification failed' }, { status: 401 })
  }
  await db.passkey.update({ where: { id: passkey.id }, data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() } })
  const user = passkey.user
  await audit(req, { actorId: user.id, action: 'login_passkey', patientId: user.role === 'PATIENT' ? user.id : null })
  return NextResponse.json(signInResponse(user))
}
