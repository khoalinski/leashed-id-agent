'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CCCD_LABELS, CCCD_TAGS, SAMPLE_CCCD, TIDE_MODE, tagRole, type CccdTag, type VaultRecord } from '@/lib/cccd'
import { rawError, useDecryptField, type DecryptResult } from '@/lib/decryptField'
import { ALL_HOTEL_FIELDS, HOTEL_FORM, HOTEL_FORM_TEXT, type MapLabelsRequest, type MapLabelsResponse } from '@/lib/hotelForm'
import { useTideCloak } from '@/lib/tide'
import { LoginGate } from '../header'
import HotelFormView, { LockIcon } from '../hotel/hotelFormView'

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
      <RunCard />
      <RolesCard />
    </main>
  )
}

// ─── FR-7: Run the agent ─────────────────────────────────────────────────────

type TagRequest = { tag: CccdTag; fieldIds: string[]; forced: boolean; result?: DecryptResult }
type AgentRun = {
  request: MapLabelsRequest
  response?: MapLabelsResponse
  tags: TagRequest[]
  error?: string
  ms?: number
}

const fieldLabel = (id: string) => {
  const f = ALL_HOTEL_FIELDS.find((x) => x.id === id)
  return f ? `${f.label}${id === HOTEL_FORM.hiddenField.id ? ' (hidden field)' : ''}` : id
}

function RunCard() {
  const decryptField = useDecryptField()
  const [compromised, setCompromised] = useState(false)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [busy, setBusy] = useState(false)

  const onRun = async () => {
    setBusy(true)
    const started = performance.now()
    const request: MapLabelsRequest = { formTitle: HOTEL_FORM.title, fields: ALL_HOTEL_FIELDS, formText: HOTEL_FORM_TEXT }
    setRun({ request, tags: [] })
    try {
      // (1)-(2) Labels and form text go to the LLM, which says which tag each field needs.
      const res = await fetch('/api/map-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const response = await res.json()
      if (!res.ok) throw new Error(`map-labels: ${res.status} - ${response.error || res.statusText}`)

      // (3) One decrypt request per tag (FR-7.3), plus the address when forced.
      const byTag = new Map<CccdTag, TagRequest>()
      const want = (tag: CccdTag) => byTag.get(tag) ?? byTag.set(tag, { tag, fieldIds: [], forced: false }).get(tag)!
      for (const m of (response as MapLabelsResponse).mapping) {
        if (m.tag) want(m.tag).fieldIds.push(m.fieldId)
      }
      if (compromised) {
        const t = want('cccd_address')
        t.forced = true
        if (!t.fieldIds.includes(HOTEL_FORM.hiddenField.id)) t.fieldIds.push(HOTEL_FORM.hiddenField.id)
      }
      const tags = [...byTag.values()]
      setRun({ request, response, tags })

      const results = await Promise.all(tags.map((t) => decryptField(t.tag)))
      setRun({ request, response, tags: tags.map((t, i) => ({ ...t, result: results[i] })), ms: Math.round(performance.now() - started) })
    } catch (err) {
      setRun((r) => ({ ...(r ?? { request, tags: [] }), error: rawError(err) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Run agent on hotel form</h2>
        <p className="muted small">The form: <Link href="/hotel?reveal=1">Khách sạn Sông Mẫu check-in</Link></p>
      </div>
      <div className="row">
        <button className="btn" onClick={onRun} disabled={busy}>{busy ? 'Running…' : 'Run agent'}</button>
        <label className="toggle">
          <input type="checkbox" checked={compromised} onChange={(e) => setCompromised(e.target.checked)} />
          Simulate compromised agent
        </label>
      </div>
      {compromised && (
        <p className="note-warn">
          Good models often refuse injections, so we force the call to prove the network blocks it even when the AI is fooled.
        </p>
      )}
      {run && <RunLog run={run} />}
    </section>
  )
}

function RunLog({ run }: { run: AgentRun }) {
  const { response, tags } = run
  const finished = tags.length > 0 && tags.every((t) => t.result)
  const denied = tags.filter((t) => t.result && !t.result.ok && t.result.reason === 'denied')
  const errored = tags.filter((t) => t.result && !t.result.ok && t.result.reason === 'error')

  const values: Record<string, string> = {}
  const locked: Record<string, boolean> = {}
  for (const t of tags) {
    for (const id of t.fieldIds) {
      if (t.result?.ok) values[id] = t.result.value
      else if (t.result) locked[id] = true
    }
  }

  // AT-6: none of the values the agent opened appear in what went to the LLM.
  const granted = tags.flatMap((t) => (t.result?.ok ? [t.result.value] : []))
  const sentText = JSON.stringify(response?.sentToLlm ?? run.request)
  const leaked = granted.filter((v) => sentText.includes(v))

  return (
    <ol className="steps">
      <li>
        <h3>
          Labels sent to the LLM{' '}
          {response?.source === 'llm' && <span className="chip chip-granted">LLM</span>}
          {response?.source === 'fallback' && <span className="chip chip-warn">LLM offline: keyword mapper</span>}
        </h3>
        {!response && !run.error && <p className="muted">Asking the LLM…</p>}
        {response?.source === 'fallback' && <p className="muted small">{response.llmError}</p>}
        {response && (
          response.sentToLlm
            ? <pre className="code">{JSON.stringify(response.sentToLlm, null, 2)}</pre>
            : <>
                <p className="muted small">The keyword mapper on the server received only this:</p>
                <pre className="code">{JSON.stringify(run.request, null, 2)}</pre>
              </>
        )}
        {finished && (
          leaked.length === 0
            ? <p className="text-granted small">✓ None of the {granted.length} decrypted values appear in what was sent.</p>
            : <p className="text-denied small">✗ Decrypted values appear in what was sent: {leaked.join(', ')}</p>
        )}
      </li>

      {response && (
        <li>
          <h3>Mapping returned</h3>
          <table className="simple">
            <thead><tr><th>Form field</th><th>Tag</th><th>Why</th></tr></thead>
            <tbody>
              {response.mapping.map((m) => (
                <tr key={m.fieldId}>
                  <td>{fieldLabel(m.fieldId)}</td>
                  <td className="mono">{m.tag ?? <span className="muted">null</span>}</td>
                  <td className="muted small">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </li>
      )}

      {tags.length > 0 && (
        <li>
          <h3>Decrypt requests, one per tag</h3>
          <table className="simple">
            <thead><tr><th>Tag</th><th>Requested for</th><th>Network answer</th></tr></thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.tag}>
                  <td className="mono">{t.tag}</td>
                  <td>
                    {t.fieldIds.map(fieldLabel).join(', ')}
                    {t.forced && <div><span className="chip chip-warn">forced by Simulate compromised agent</span></div>}
                  </td>
                  <td>
                    {!t.result && <span className="muted">Asking…</span>}
                    {t.result?.ok && <span className="chip chip-granted">granted</span>}
                    {t.result && !t.result.ok && t.result.reason === 'denied' && <span className="chip chip-denied"><LockIcon /> denied</span>}
                    {t.result && !t.result.ok && t.result.reason === 'error' && <span className="chip chip-warn">error</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {denied.map((t) => (
            <div key={t.tag}>
              <div className="banner-denied" role="alert">
                Denied by Tide network: the agent holds no decrypt role for <code>{t.tag}</code>.
              </div>
              <div className="dev-panel">
                <h4>Developer panel: raw error from doDecrypt{TIDE_MODE === 'simulated' ? ' (simulated network)' : ''}</h4>
                <pre className="code">{t.result && !t.result.ok ? t.result.raw : ''}</pre>
              </div>
            </div>
          ))}
          {errored.map((t) => (
            <div key={t.tag} className="dev-panel">
              <h4 className="text-warn">Error for {t.tag}</h4>
              <pre className="code">{t.result && !t.result.ok ? t.result.raw : ''}</pre>
            </div>
          ))}
        </li>
      )}

      {finished && (
        <li>
          <h3>Filled form <span className="muted small">(read-only preview, never sent anywhere)</span></h3>
          <HotelFormView reveal values={values} locked={locked} />
          {run.ms !== undefined && <p className="muted small">Agent run took {(run.ms / 1000).toFixed(1)} s.</p>}
        </li>
      )}

      {run.error && <li><h3 className="text-denied">Run failed</h3><pre className="code">{run.error}</pre></li>}
    </ol>
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
