/**
 * Patient accounts made by their doctor: a username and a 6-digit PIN (what the clinic game's
 * sign-in takes too), one-time QR sign-in links, and the user shape every sign-in route returns.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { User } from '@prisma/client'
import { db } from '@/lib/db'
import { signToken } from '@/lib/auth'

/** Patients without an email get an internal address on a reserved domain that can never receive mail. */
export const PATIENT_EMAIL_DOMAIN = 'patients.nuhoud.invalid'
export const QR_TTL_MS = 24 * 60 * 60 * 1000
export const CONSENT_VERSION = 'trial-2026-10'

export const USERNAME_RE = /^[a-z][a-z0-9_.-]{2,23}$/

export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** A short username that is easy to type in the clinic: nh + 4 digits, unused. */
export async function suggestUsername(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const name = `nh${randomInt(1000, 10000)}`
    if (!(await db.user.findUnique({ where: { username: name }, select: { id: true } }))) return name
  }
  return `nh${randomInt(100000, 1000000)}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A single-use sign-in token for the QR code; only its hash is stored. */
export async function issueLoginToken(userId: string, createdById: string) {
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + QR_TTL_MS)
  // A new code replaces the patient's earlier unused ones.
  await db.loginToken.deleteMany({ where: { userId, usedAt: null } })
  await db.loginToken.create({ data: { tokenHash: hashToken(token), userId, createdById, expiresAt } })
  return { token, expiresAt }
}

export function publicUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    email: user.email.endsWith(`@${PATIENT_EMAIL_DOMAIN}`) ? '' : user.email,
    username: user.username,
    name: user.name,
    avatarSeed: user.avatarSeed,
    preferredDialect: user.preferredDialect,
    affectedSide: user.affectedSide,
    dateOfBirth: user.dateOfBirth,
    patientConsentAt: user.patientConsentAt,
  }
}

export function signInResponse(user: User) {
  return { ok: true, token: signToken({ id: user.id, role: user.role, email: user.email, name: user.name, tokenVersion: user.tokenVersion }), user: publicUser(user) }
}
