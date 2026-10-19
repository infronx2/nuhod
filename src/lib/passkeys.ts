/**
 * Passkeys (WebAuthn): Face ID or a fingerprint on the patient's phone. The relying party is the
 * host the page was served from; the challenge travels in a short signed token instead of a table.
 */
import type { NextRequest } from 'next/server'
import { signShort, verifyShort } from '@/lib/auth'

export const RP_NAME = 'Nuhoud'

export function relyingParty(req: NextRequest) {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host).split(',')[0].trim()
  const rpID = host.split(':')[0]
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || (rpID === 'localhost' ? 'http' : 'https')
  return { rpID, origin: `${proto}://${host}` }
}

export function challengeToken(challenge: string, kind: 'register' | 'login', userId = '') {
  return signShort({ challenge, kind, userId }, 5 * 60)
}

export function readChallenge(token: unknown, kind: 'register' | 'login') {
  const p = typeof token === 'string' ? verifyShort(token) : null
  return p && p.kind === kind ? p : null
}
