import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { challengeToken, relyingParty } from '@/lib/passkeys'

// POST /api/v2/auth/passkey/login-options — no username needed; the phone offers its passkeys.
export async function POST(req: NextRequest) {
  const { rpID } = relyingParty(req)
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
  return NextResponse.json({ ok: true, options, challengeToken: challengeToken(options.challenge, 'login') })
}
