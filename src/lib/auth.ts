/**
 * Nuhoud auth helpers — JWT issue + verify, password hash + compare.
 *
 * Uses HS256 with a per-process secret. In production this would come from a
 * secret manager; here we fall back to a deterministic dev secret so tokens
 * survive across dev-server reloads within the same sandbox session.
 */
import jwt, { type JwtPayload } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

/** The signing secret. In production a missing secret refuses to sign rather than fall back to a public one. */
function secret(): string {
  const s = process.env.NUHOUD_JWT_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL) throw new Error('NUHOUD_JWT_SECRET is not set')
  return 'nuhoud-dev-secret-change-in-prod-7f3a9e1b'
}

// Patients stay signed in on their own phone for a week; staff, who open every record, for 12 hours.
const PATIENT_TTL_SECONDS = 60 * 60 * 24 * 7
const STAFF_TTL_SECONDS = 60 * 60 * 12

export interface AuthUser {
  id: string
  role: string
  email: string
  name: string
}

export interface NeuromoveJwtPayload extends JwtPayload {
  sub: string
  role: string
  email: string
  name: string
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string | null | undefined): boolean {
  if (!hash) return false
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    secret(),
    { expiresIn: user.role.toUpperCase() === 'PATIENT' ? PATIENT_TTL_SECONDS : STAFF_TTL_SECONDS, algorithm: 'HS256' },
  )
}

export function verifyToken(token: string): NeuromoveJwtPayload | null {
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as NeuromoveJwtPayload & { purpose?: string }
    // A passkey challenge token is not a sign-in.
    if (payload.purpose || !payload.sub || !payload.role) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Extract + verify a Bearer token from a Next.js Request. Returns the decoded
 * payload or null. Also coerces the role to uppercase for downstream checks.
 */
export function getUserFromRequest(req: Request): NeuromoveJwtPayload | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  return verifyToken(token)
}

export function requireRole(
  user: NeuromoveJwtPayload | null,
  role: string,
): boolean {
  return !!user && user.role.toUpperCase() === role.toUpperCase()
}

/** Short-lived signed value (a passkey challenge) the client hands back; nothing stored server-side. */
export function signShort(data: Record<string, string>, seconds: number): string {
  return jwt.sign({ ...data, purpose: 'short' }, secret(), { expiresIn: seconds, algorithm: 'HS256' })
}

export function verifyShort(token: string): Record<string, string> | null {
  try {
    const p = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as Record<string, string>
    return p.purpose === 'short' ? p : null
  } catch {
    return null
  }
}
