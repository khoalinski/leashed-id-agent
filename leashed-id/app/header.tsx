'use client'

import Link from 'next/link'
import { TIDE_MODE } from '@/lib/cccd'
import { useTideCloak } from '@/lib/tide'

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
