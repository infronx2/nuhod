'use client'

import * as React from 'react'
import { ApiError, apiFetch, getToken, setToken } from '@/lib/api'
import type { V2User } from '@/lib/v2-types'

/**
 * useAuth — React context that owns the Nuhoud JWT auth lifecycle.
 *
 * On mount, loads a token from localStorage and validates it against
 * /api/v2/auth/me. Exposes login/register/logout and the current user.
 *
 * All v2 API calls go through `apiFetch` which auto-attaches the token.
 * On a 401, the token is cleared and the next render sees `user === null`,
 * routing the user back to the AuthScreen.
 */

interface AuthState {
  user: V2User | null
  loading: boolean
  login: (email: string, password: string) => Promise<V2User>
  register: (input: {
    email: string
    name: string
    password: string
    role?: 'PATIENT' | 'DOCTOR'
    affectedSide?: 'right' | 'left' | 'bilateral'
    inviteCode?: string
  }) => Promise<V2User>
  logout: () => void
  refresh: () => Promise<void>
  /** Takes the reply of any sign-in route (QR code, passkey) and signs the user in. */
  acceptSignIn: (data: { token: string; user: V2User }) => V2User
}

const AuthContext = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<V2User | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    // Only the server saying the token is invalid (401, which apiFetch clears) signs the user out.
    // A network error or a slow cold start is retried, and the token is kept for the next visit.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await apiFetch<{ ok: boolean; user: V2User }>('/api/v2/auth/me')
        if (data.ok && data.user) {
          setUser(data.user)
        } else {
          setUser(null)
          setToken(null)
        }
        break
      } catch (err) {
        if ((err instanceof ApiError && err.status === 401) || attempt === 2) {
          setUser(null)
          break
        }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      }
    }
    setLoading(false)
  }, [])

  // Validate the persisted token once on mount.
  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const login = React.useCallback(
    async (email: string, password: string): Promise<V2User> => {
      const data = await apiFetch<{
        ok: boolean
        token: string
        user: V2User
      }>('/api/v2/auth/login', {
        method: 'POST',
        json: { email, password },
        noAuth: true,
      })
      if (!data.ok || !data.token) throw new Error('Login failed')
      setToken(data.token)
      setUser(data.user)
      return data.user
    },
    [],
  )

  const register = React.useCallback(
    async (input: {
      email: string
      name: string
      password: string
      role?: 'PATIENT' | 'DOCTOR'
      affectedSide?: 'right' | 'left' | 'bilateral'
      inviteCode?: string
    }): Promise<V2User> => {
      const data = await apiFetch<{
        ok: boolean
        token: string
        user: V2User
      }>('/api/v2/auth/register', {
        method: 'POST',
        json: input,
        noAuth: true,
      })
      if (!data.ok || !data.token) throw new Error('Registration failed')
      setToken(data.token)
      setUser(data.user)
      return data.user
    },
    [],
  )

  const acceptSignIn = React.useCallback((data: { token: string; user: V2User }) => {
    setToken(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = React.useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = React.useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, refresh, acceptSignIn }),
    [user, loading, login, register, logout, refresh, acceptSignIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
