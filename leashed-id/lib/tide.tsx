'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { TideCloakProvider, useTideCloak as useRealTideCloak, type TideCloakContextValue } from '@tidecloak/nextjs'
import tcConfig from '../tidecloak.json'
import { TIDE_MODE } from './cccd'

// The slice of the TideCloak SDK this app uses. Pages import useTideCloak from
// here and call it exactly like the generator's app/home/page.tsx does. Real mode
// returns the SDK's own hook; simulated mode (Plan C) implements the same
// signatures on top of lib/simTide.ts.
export type TideSession = Pick<
  TideCloakContextValue,
  'isInitializing' | 'authenticated' | 'token' | 'login' | 'logout' |
  'hasRealmRole' | 'getValueFromIdToken' | 'doEncrypt' | 'doDecrypt'
>

export const SIM_TOKEN_KEY = 'leashed-sim-token'

const SimContext = createContext<TideSession | null>(null)

export function TideProvider({ children }: { children: ReactNode }) {
  return TIDE_MODE === 'real'
    ? <TideCloakProvider config={tcConfig}>{children}</TideCloakProvider>
    : <SimTideCloakProvider>{children}</SimTideCloakProvider>
}

function useSimTideCloak(): TideSession {
  const ctx = useContext(SimContext)
  if (!ctx) throw new Error('useTideCloak must be used inside <TideProvider>')
  return ctx
}

// TIDE_MODE is fixed at build time, so every render calls the same hook.
export const useTideCloak: () => TideSession = TIDE_MODE === 'real' ? useRealTideCloak : useSimTideCloak

// ─── Simulated SDK ───────────────────────────────────────────────────────────

const utf8 = new TextEncoder()

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}

function decodeJwt(token: string): Record<string, any> | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64(token.split('.')[1])))
  } catch {
    return null
  }
}

type EncryptItem = { data: string; tags: string[] }
type DecryptItem = { encrypted: string; tags: string[] }

// Simulated ciphertext: simtide1.<ciphertext>.<iv>.<wrapped data key>.<tag>
// (ciphertext first, so the FR-2.4 preview differs per field).
const ENVELOPE_PREFIX = 'simtide1'

// Every refusal comes back from the simulated network as the thrown error's message.
async function callSimNetwork(token: string | null, body: object): Promise<Record<string, string>> {
  const res = await fetch('/api/sim-tide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `SIMULATED Tide network: HTTP ${res.status}`)
  return data
}

function onlyTag(tags: string[]): string {
  if (!Array.isArray(tags) || tags.length !== 1) {
    throw new Error('SIMULATED Tide network: give exactly one tag per item')
  }
  return tags[0]
}

async function simEncryptItem(token: string | null, { data, tags }: EncryptItem): Promise<string> {
  const tag = onlyTag(tags)
  const { dek, wrapped } = await callSimNetwork(token, { op: 'encrypt', tag })
  const key = await crypto.subtle.importKey('raw', fromB64(dek), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(tag) }, key, utf8.encode(String(data)))
  return [ENVELOPE_PREFIX, toB64(ct), toB64(iv), wrapped, tag].join('.')
}

async function simDecryptItem(token: string | null, { encrypted, tags }: DecryptItem): Promise<string> {
  const parts = String(encrypted).split('.')
  if (parts.length !== 5 || parts[0] !== ENVELOPE_PREFIX) {
    throw new Error('SIMULATED Tide network: not a simulated Tide ciphertext')
  }
  const [, ct, iv, wrapped, tag] = parts
  const { dek } = await callSimNetwork(token, { op: 'decrypt', tag, tags, wrapped })
  const key = await crypto.subtle.importKey('raw', fromB64(dek), 'AES-GCM', false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: utf8.encode(tag) }, key, fromB64(ct))
  return new TextDecoder().decode(pt)
}

function SimTideCloakProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem(SIM_TOKEN_KEY) } catch {}
    const exp = stored ? decodeJwt(stored)?.exp : null
    if (stored && typeof exp === 'number' && exp * 1000 > Date.now()) {
      setToken(stored)
    } else if (stored) {
      try { localStorage.removeItem(SIM_TOKEN_KEY) } catch {}
    }
    setIsInitializing(false)
  }, [])

  const claims = useMemo(() => (token ? decodeJwt(token) : null), [token])

  const login = useCallback(async () => {
    window.location.assign('/sim-tidecloak/login')
  }, [])

  const logout = useCallback(async () => {
    try { localStorage.removeItem(SIM_TOKEN_KEY) } catch {}
    setToken(null)
    window.location.assign('/')
  }, [])

  // Display only, like the real SDK: the network checks roles again on every call.
  const hasRealmRole = useCallback(
    (role: string) => Boolean(claims?.realm_access?.roles?.includes(role)),
    [claims],
  )
  const getValueFromIdToken = useCallback((key: string) => claims?.[key], [claims])

  const doEncrypt = useCallback(
    (items: EncryptItem[]) => Promise.all(items.map((item) => simEncryptItem(token, item))),
    [token],
  )
  const doDecrypt = useCallback(
    (items: DecryptItem[]) => Promise.all(items.map((item) => simDecryptItem(token, item))),
    [token],
  )

  const value = useMemo<TideSession>(() => ({
    isInitializing,
    authenticated: Boolean(token),
    token,
    login,
    logout,
    hasRealmRole,
    getValueFromIdToken,
    doEncrypt,
    doDecrypt,
  }), [isInitializing, token, login, logout, hasRealmRole, getValueFromIdToken, doEncrypt, doDecrypt])

  return <SimContext.Provider value={value}>{children}</SimContext.Provider>
}
