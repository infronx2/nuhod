/**
 * Nuhoud auth helpers — JWT issue + verify, password hash + compare.
 *
 * Uses HS256 with a per-process secret. In production this would come from a
 * secret manager; here we fall back to a deterministic dev secret so tokens
 * survive across dev-server reloads within the same sandbox session.
 */
import jwt, { type JwtPayload } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const DEV_SECRET =
  process.env.NUHOUD_JWT_SECRET ||
  'nuhoud-dev-secret-change-in-prod-7f3a9e1b'

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

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
    DEV_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS, algorithm: 'HS256' },
  )
}

export function verifyToken(token: string): NeuromoveJwtPayload | null {
  try {
    const payload = jwt.verify(token, DEV_SECRET) as NeuromoveJwtPayload
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
