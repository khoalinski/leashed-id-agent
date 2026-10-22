'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { VaultRecord } from '@/lib/cccd'
import { useTideCloak } from '@/lib/tide'
import { LoginGate } from '../header'

export default function VaultPage() {
  return (
    <LoginGate title="Vault">
      <VaultView />
    </LoginGate>
  )
}

// Exactly what the server stores for this account (FR-8.2).
function VaultView() {
  const { token } = useTideCloak()
  const [record, setRecord] = useState<VaultRecord | null | undefined>(undefined)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/vault', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (!res.ok) throw new Error(`${res.status} - ${data.error || res.statusText}`)
      setRecord(data.record)
    } catch (err: any) {
      setError(err.message || 'Could not load the vault')
    }
  }, [token])

  useEffect(() => { if (token) load() }, [token, load])

  return (
    <main className="page">
      <h1>Vault</h1>
      <p className="lead">What the app&apos;s server stores for your account, read straight from <code>/api/vault</code>.</p>

      <div className="card">
        <div className="card-head">
          <p className="note-warn" style={{ margin: 0 }}>
            <strong>No plaintext is stored. This is everything the server holds.</strong>
          </p>
          <button className="btn btn-secondary btn-small" onClick={load}>Refresh</button>
        </div>
        {error && <p className="text-denied">{error}</p>}
        {record === undefined && !error && <p className="muted">Loading…</p>}
        {record === null && (
          <p className="muted">
            Nothing stored yet. <Link href="/agent">Load your CCCD in the Agent console</Link>.
          </p>
        )}
        {record && <pre className="code">{JSON.stringify(record, null, 2)}</pre>}
      </div>
    </main>
  )
}
