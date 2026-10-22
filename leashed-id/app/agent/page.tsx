'use client'

import { useCallback, useEffect, useState } from 'react'
import { CCCD_LABELS, CCCD_TAGS, SAMPLE_CCCD, tagRole, type CccdTag, type VaultRecord } from '@/lib/cccd'
import { rawError, useDecryptField, type DecryptResult } from '@/lib/decryptField'
import { useTideCloak } from '@/lib/tide'
import { LoginGate } from '../header'

export default function AgentPage() {
  return (
    <LoginGate title="Agent console">
      <AgentConsole />
    </LoginGate>
  )
}

function AgentConsole() {
  const { getValueFromIdToken } = useTideCloak()
  const username = String(getValueFromIdToken('preferred_username') ?? '')

  return (
    <main className="page">
      <h1>Agent console</h1>
      <p className="lead">
        Logged in as the AI agent&apos;s account, <strong>{username}</strong>. Encryption and decryption run in
        this browser; the server only ever holds ciphertext.
      </p>
      <LoadCard />
      <RolesCard />
    </main>
  )
}

// ─── FR-2: Load my CCCD once ─────────────────────────────────────────────────

function LoadCard() {
  const { token, doEncrypt } = useTideCloak()
  const [values, setValues] = useState<Record<CccdTag, string>>(SAMPLE_CCCD)
  const [saved, setSaved] = useState<VaultRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CccdTag, string>>>({})

  const vaultFetch = useCallback(
    (init?: RequestInit) => fetch('/api/vault', { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }),
    [token],
  )

  useEffect(() => {
    vaultFetch().then((res) => res.json()).then((data) => setSaved(data.record ?? null)).catch(() => {})
  }, [vaultFetch])

  const onSave = async () => {
    setBusy(true); setError(''); setFieldErrors({})
    try {
      if (CCCD_TAGS.some((tag) => !values[tag].trim())) throw new Error('Fill in all 4 fields first.')

      // One doEncrypt call, 4 items, each under its own tag (FR-2.3). Only ciphertext leaves the browser.
      let ciphertexts: unknown[]
      try {
        ciphertexts = await doEncrypt(CCCD_TAGS.map((tag) => ({ data: values[tag], tags: [tag] })))
      } catch (err) {
        // FR-2.5: find the field(s) that failed and show each raw SDK error. Save nothing.
        const perField: Partial<Record<CccdTag, string>> = {}
        for (const tag of CCCD_TAGS) {
          try { await doEncrypt([{ data: values[tag], tags: [tag] }]) } catch (e) { perField[tag] = rawError(e) }
        }
        setFieldErrors(perField)
        throw new Error(`Encryption failed, nothing was saved. ${Object.keys(perField).length ? '' : rawError(err)}`)
      }

      const fields = Object.fromEntries(CCCD_TAGS.map((tag, i) => [tag, String(ciphertexts[i])])) as Record<CccdTag, string>
      const res = await vaultFetch({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
      const data = await res.json()
      if (!res.ok) throw new Error(`Vault: ${res.status} - ${data.error || res.statusText}`)
      setSaved(data.record)
    } catch (err) {
      setError(rawError(err))
    } finally {
      setBusy(false)
    }
  }

  const onClear = async () => {
    setError('')
    const res = await vaultFetch({ method: 'DELETE' })
    if (res.ok) setSaved(null)
    else setError(`Vault: ${res.status}`)
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Load my CCCD once</h2>
        <p className="muted small">Fake sample data, prefilled</p>
      </div>
      <div className="grid-2">
        {CCCD_TAGS.map((tag) => (
          <label className="field" key={tag}>
            <span>{CCCD_LABELS[tag].en} <small>({CCCD_LABELS[tag].vi})</small></span>
            <input value={values[tag]} onChange={(e) => setValues({ ...values, [tag]: e.target.value })} />
            {fieldErrors[tag] && <small className="text-denied mono">{fieldErrors[tag]}</small>}
          </label>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={onSave} disabled={busy}>{busy ? 'Encrypting…' : 'Encrypt and save'}</button>
        {saved && <button className="btn btn-secondary btn-small" onClick={onClear} disabled={busy}>Clear vault</button>}
      </div>
      {error && <p className="text-denied">{error}</p>}
      {saved && (
        <div style={{ marginTop: 16 }}>
          <p className="text-granted" style={{ fontWeight: 700, margin: '0 0 6px' }}>Saved: the server holds ciphertext only</p>
          <table className="simple">
            <tbody>
              {CCCD_TAGS.map((tag) => (
                <tr key={tag}>
                  <td style={{ width: '38%' }}>{CCCD_LABELS[tag].en} <span className="muted mono">{tag}</span></td>
                  <td className="mono">{saved.fields[tag].slice(0, 24)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ─── FR-8.1: Token roles ─────────────────────────────────────────────────────

function RolesCard() {
  const { hasRealmRole } = useTideCloak()
  const decryptField = useDecryptField()
  const [probes, setProbes] = useState<Partial<Record<CccdTag, DecryptResult | 'pending'>>>({})

  const probe = async (tag: CccdTag) => {
    setProbes((p) => ({ ...p, [tag]: 'pending' }))
    const result = await decryptField(tag)
    setProbes((p) => ({ ...p, [tag]: result }))
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Token roles</h2>
        <p className="muted small">Display only: decryptField never checks these. The network does.</p>
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {CCCD_TAGS.map((tag) => {
          const role = tagRole(tag, 'selfdecrypt')
          return hasRealmRole(role)
            ? <span key={tag} className="chip chip-granted mono">✓ {role}</span>
            : <span key={tag} className="chip mono">{role} · not granted</span>
        })}
      </div>
      <table className="simple">
        <thead>
          <tr><th>Field</th><th>Ask the network to decrypt it</th></tr>
        </thead>
        <tbody>
          {CCCD_TAGS.map((tag) => {
            const result = probes[tag]
            return (
              <tr key={tag}>
                <td style={{ width: '30%' }}>
                  <button className="btn btn-secondary btn-small" onClick={() => probe(tag)} disabled={result === 'pending'}>
                    Decrypt {CCCD_LABELS[tag].en.toLowerCase()}
                  </button>
                </td>
                <td>
                  {result === 'pending' && <span className="muted">Asking…</span>}
                  {result && result !== 'pending' && result.ok && <span className="text-granted">Granted: <strong>{result.value}</strong></span>}
                  {result && result !== 'pending' && !result.ok && (
                    <span className={result.reason === 'denied' ? 'text-denied' : 'text-warn'}>
                      <strong>{result.reason === 'denied' ? 'Denied' : 'Error'}:</strong> <span className="mono">{result.raw}</span>
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
