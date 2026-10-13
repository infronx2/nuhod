/**
 * apiFetch — thin wrapper around fetch that auto-attaches the Nuhoud JWT
 * Bearer token and gracefully handles 401 by clearing the token and bouncing
 * the user back to the unauthenticated state.
 *
 * All v2 Next.js API routes (under /api/v2) are served by the Next.js dev
 * server itself, so NO XTransformPort is required.
 */

const TOKEN_KEY = 'nuhoud_token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore storage errors */
  }
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Send as JSON (sets headers + JSON.stringify the body). */
  json?: unknown
  /** Skip the Bearer token (for the auth endpoints themselves). */
  noAuth?: boolean
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { json, noAuth, headers, ...rest } = opts
  const finalHeaders = new Headers(headers)
  if (json !== undefined) {
    finalHeaders.set('Content-Type', 'application/json')
  }
  if (!noAuth) {
    const token = getToken()
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(path, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })

  // Try to parse JSON regardless of status so callers get the error body.
  let parsed: unknown = null
  const text = await res.text()
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !noAuth) {
      // Token is invalid/expired — clear it so the auth hook can bounce to login.
      setToken(null)
    }
    const msg =
      (parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`) || `HTTP ${res.status}`
    throw new ApiError(msg, res.status, parsed)
  }

  return parsed as T
}
