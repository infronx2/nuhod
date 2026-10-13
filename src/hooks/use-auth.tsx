'use client'

import * as React from 'react'
import { apiFetch, getToken, setToken } from '@/lib/api'
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
  }) => Promise<V2User>
  logout: () => void
  refresh: () => Promise<void>
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
    try {
      const data = await apiFetch<{ ok: boolean; user: V2User }>(
        '/api/v2/auth/me',
      )
      if (data.ok && data.user) {
        setUser(data.user)
      } else {
        setUser(null)
        setToken(null)
      }
    } catch {
      setUser(null)
      setToken(null)
    } finally {
      setLoading(false)
    }
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

  const logout = React.useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = React.useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
