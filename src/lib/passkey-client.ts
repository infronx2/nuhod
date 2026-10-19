'use client'

/**
 * Browser side of passkeys: Face ID / fingerprint sign-in and adding one to this phone. The face or
 * fingerprint is checked by the phone itself; only a signed answer reaches the server.
 */
import * as React from 'react'
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { apiFetch } from '@/lib/api'
import type { V2User } from '@/lib/v2-types'

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn()
}

const noSubscribe = () => () => {}
/** Whether this browser can use passkeys (false while rendering on the server). */
export function usePasskeysSupported(): boolean {
  return React.useSyncExternalStore(noSubscribe, passkeysSupported, () => false)
}

export async function signInWithPasskey(): Promise<{ token: string; user: V2User }> {
  const start = await apiFetch<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeToken: string }>(
    '/api/v2/auth/passkey/login-options', { method: 'POST', noAuth: true },
  )
  const response = await startAuthentication({ optionsJSON: start.options })
  return apiFetch('/api/v2/auth/passkey/login-verify', {
    method: 'POST', noAuth: true, json: { response, challengeToken: start.challengeToken },
  })
}

export async function addPasskey(): Promise<void> {
  const start = await apiFetch<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeToken: string }>(
    '/api/v2/auth/passkey/register-options', { method: 'POST' },
  )
  const response = await startRegistration({ optionsJSON: start.options })
  await apiFetch('/api/v2/auth/passkey/register-verify', {
    method: 'POST', json: { response, challengeToken: start.challengeToken, deviceLabel: deviceLabel() },
  })
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device'
}
