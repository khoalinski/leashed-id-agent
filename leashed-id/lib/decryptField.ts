'use client'

import { useCallback } from 'react'
import type { CccdTag } from './cccd'
import { useTideCloak } from './tide'

// The leash check (FR-4). The contract shared with the Agent console (SRS 6.1).
export type { CccdTag }
export type DecryptResult =
  | { ok: true; tag: CccdTag; value: string }
  | { ok: false; tag: CccdTag; reason: 'denied' | 'error'; raw: string }

// FR-4.4. First the refusal Tide's network gives for a missing decrypt role
// ("vendordecrypt voucher not allowed", per Tide's e2ee playbook; the simulated
// network uses the same words), then the SRS's broad fallback.
const DENIED_PATTERNS = [/voucher not allowed/i, /role|permission|forbidden|not.?authori|access|tag/i]

// The full error message, plus its code if it has one.
export function rawError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code
    return code !== undefined ? `${err.message} (code: ${String(code)})` : err.message
  }
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

export function useDecryptField(): (tag: CccdTag) => Promise<DecryptResult> {
  const { token, doDecrypt } = useTideCloak()

  return useCallback(async (tag: CccdTag): Promise<DecryptResult> => {
    let encrypted: string | undefined
    try {
      const res = await fetch('/api/vault', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (!res.ok) return { ok: false, tag, reason: 'error', raw: `Vault: ${res.status} - ${data.error || res.statusText}` }
      encrypted = data.record?.fields?.[tag]
    } catch (err) {
      return { ok: false, tag, reason: 'error', raw: rawError(err) }
    }
    if (!encrypted) {
      return { ok: false, tag, reason: 'error', raw: `No ciphertext in vault for ${tag}. Load your CCCD first.` }
    }

    // ALWAYS ask the network. No role pre-check here (FR-4.2): a refusal must come
    // from doDecrypt, never from this app. No retry, no substitute value (FR-4.5).
    try {
      const [value] = await doDecrypt([{ encrypted, tags: [tag] }])
      if (value instanceof Error) throw value
      return { ok: true, tag, value: String(value) }
    } catch (err) {
      const raw = rawError(err)
      return { ok: false, tag, reason: DENIED_PATTERNS.some((p) => p.test(raw)) ? 'denied' : 'error', raw }
    }
  }, [token, doDecrypt])
}
