'use client'

import { useState, type FormEvent } from 'react'
import { TIDE_MODE } from '@/lib/cccd'
import { SIM_TOKEN_KEY } from '@/lib/tide'

// SIMULATED TideCloak sign-in (Plan C). Stands in for the Tide enclave's login page.
export default function SimLoginPage() {
  const [username, setUsername] = useState('agent')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (TIDE_MODE !== 'simulated') {
    return (
      <main className="page narrow">
        <div className="card"><h1>Not available</h1><p className="muted">Real mode signs in through TideCloak.</p></div>
      </main>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/sim-tidecloak/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      localStorage.setItem(SIM_TOKEN_KEY, data.access_token)
      // Same landing route as the real login flow (/auth/redirect).
      window.location.assign('/auth/redirect')
    } catch (err: any) {
      setError(err.message || 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <main className="page narrow">
      <div className="card">
        <p className="eyebrow">TideCloak · simulated</p>
        <h1>Sign in</h1>
        <p className="muted">
          Stands in for Tide&apos;s sign-in while the Tide network can&apos;t license realms. No password is
          checked. A new username becomes an account with the default roles from <code>init/realm.json</code>.
        </p>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </label>
          <button className="btn" disabled={busy || !username.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {error && <p className="text-denied">{error}</p>}
        <p className="muted small">Use <strong>agent</strong> for the AI agent&apos;s account.</p>
      </div>
    </main>
  )
}
