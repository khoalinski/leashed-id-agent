import Link from 'next/link'

// Landing (FR-8.3): the idea in 3 lines, and where to look.
export default function LandingPage() {
  return (
    <main className="page">
      <p className="eyebrow">Tide UNLOCKED · Challenge 2</p>
      <h1>Hand your ID paperwork to an AI, not your whole ID.</h1>
      <div className="card" style={{ marginTop: 20 }}>
        <ol style={{ margin: 0, paddingLeft: 22, fontSize: '1.05rem', lineHeight: 1.7 }}>
          <li>Your CCCD is stored field by field as ciphertext. The server never sees the values.</li>
          <li>The AI agent&apos;s account can decrypt your name, date of birth and ID number, but holds no decrypt role for your home address.</li>
          <li>When a hostile form tricks the agent into asking for the address, the Tide network refuses. The app&apos;s code never makes that call.</li>
        </ol>
        <div className="row" style={{ marginTop: 20 }}>
          <Link href="/agent" className="btn">Open the Agent console</Link>
          <Link href="/hotel?reveal=1">See the hostile hotel form</Link>
          <Link href="/vault">See what the server stores</Link>
        </div>
      </div>
      <p className="muted small">
        The agent cannot decrypt any field it was not granted. Widening its leash means a new role, and in
        TideCloak a role grant waits for a quorum of admins to approve it.
      </p>
    </main>
  )
}
