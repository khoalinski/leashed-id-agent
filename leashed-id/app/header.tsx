'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { TIDE_MODE } from '@/lib/cccd'
import { useTideCloak } from '@/lib/tide'

// /agent and /vault: only usable when authenticated, otherwise a Log in button (FR-1.2).
export function LoginGate({ title, children }: { title: string; children: ReactNode }) {
  const { authenticated, isInitializing, login } = useTideCloak()
  if (isInitializing) {
    return <main className="page"><p className="muted">Checking your session…</p></main>
  }
  if (!authenticated) {
    return (
      <main className="page narrow">
        <div className="card">
          <h1>{title}</h1>
          <p className="muted">Log in to use this page.</p>
          <button className="btn" onClick={() => login()}>Log in</button>
        </div>
      </main>
    )
  }
  return <>{children}</>
}

// Every page: the simulated-mode banner (FR-10.3) and who is logged in (FR-1.3).
export default function Header() {
  const { authenticated, isInitializing, getValueFromIdToken, login, logout } = useTideCloak()
  const username = authenticated ? String(getValueFromIdToken('preferred_username') ?? '') : ''

  return (
    <>
      {TIDE_MODE === 'simulated' && (
        <div className="sim-banner" role="status">
          SIMULATED: not connected to the Tide network. Denials are not real Tide responses.
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">Leashed ID Agent</Link>
          <nav className="nav">
            <Link href="/agent">Agent console</Link>
            <Link href="/hotel?reveal=1">Hotel form</Link>
            <Link href="/vault">Vault</Link>
            {TIDE_MODE === 'simulated' && <Link href="/sim-tidecloak/admin">Approvals</Link>}
          </nav>
          <div className="who">
            {isInitializing ? null : authenticated ? (
              <>
                <span>Logged in as <strong>{username}</strong></span>
                <button className="btn btn-small btn-secondary" onClick={() => logout()}>Log out</button>
              </>
            ) : (
              <button className="btn btn-small" onClick={() => login()}>Log in</button>
            )}
          </div>
        </div>
      </header>
    </>
  )
}
