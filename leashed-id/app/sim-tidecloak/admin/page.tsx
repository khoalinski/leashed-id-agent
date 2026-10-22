'use client'

import { useCallback, useEffect, useState } from 'react'
import { rawError } from '@/lib/decryptField'
import type { SimChangeRequest, SimRealmOverview } from '@/lib/simTide'
import { useTideCloak } from '@/lib/tide'
import { LoginGate } from '../../header'

// SIMULATED TideCloak admin console: change requests and quorum approvals (FR-9, Plan C).
export default function SimAdminPage() {
  return (
    <LoginGate title="Change requests">
      <AdminConsole />
    </LoginGate>
  )
}

const STATUS_CHIP: Record<SimChangeRequest['status'], [string, string]> = {
  PENDING: ['chip chip-warn', 'Pending'],
  APPROVED: ['chip chip-granted', 'Approved and applied'],
  DENIED: ['chip chip-denied', 'Denied'],
}

function AdminConsole() {
  const { token } = useTideCloak()
  const [data, setData] = useState<SimRealmOverview | null>(null)
  const [forbidden, setForbidden] = useState('')
  const [username, setUsername] = useState('agent')
  const [role, setRole] = useState('_tide_cccd_address.selfdecrypt')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (init?: RequestInit) => {
    const res = await fetch('/api/sim-tidecloak/admin', {
      ...init,
      headers: { ...init?.headers, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status })
    return { status: res.status, body }
  }, [token])

  const load = useCallback(async () => {
    try {
      setData((await call()).body)
    } catch (err: any) {
      if (err.status === 403) setForbidden(err.message)
      else setError(rawError(err))
    }
  }, [call])

  useEffect(() => { if (token) load() }, [token, load])

  const act = async (payload: object, describe: (status: number, body: any) => string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const { status, body } = await call({ method: 'POST', body: JSON.stringify(payload) })
      setNotice(describe(status, body))
      await load()
    } catch (err) {
      setError(rawError(err))
    } finally {
      setBusy(false)
    }
  }

  if (forbidden) {
    return (
      <main className="page narrow">
        <div className="card">
          <p className="eyebrow">TideCloak admin console · simulated</p>
          <h1>Admins only</h1>
          <p className="muted">{forbidden}. Log out, then log in as <strong>admin1</strong>, <strong>admin2</strong> or <strong>admin3</strong>.</p>
        </div>
      </main>
    )
  }
  if (!data) {
    return <main className="page">{error ? <p className="text-denied">{error}</p> : <p className="muted">Loading…</p>}</main>
  }

  const quorum = `${data.threshold} of ${data.admins.length}`
  const pending = data.changeRequests.filter((cr) => cr.status === 'PENDING').length

  const request = (op: 'grant' | 'revoke') => act({ op, username, role }, (status, body) =>
    `${status} Accepted: captured as change request ${body.changeRequest.id.slice(0, 8)}. Nothing changes until ${quorum} admins approve it.`)

  return (
    <main className="page">
      <p className="eyebrow">TideCloak admin console · simulated</p>
      <h1>Change requests</h1>
      <p className="lead">
        In TideCloak, a role change does not apply when an admin makes it. It becomes a change request, and it
        applies only once a quorum of realm admins approve it (QEA). This realm has {data.admins.length} admins,
        so the quorum is {quorum}.
      </p>

      <section className="card">
        <div className="card-head">
          <h2>Change a user&apos;s roles</h2>
          <p className="muted small">Logged in as admin <strong>{data.you}</strong></p>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>User</span>
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              {data.users.filter((u) => !u.admin).map((u) => <option key={u.username}>{u.username}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Realm role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {data.roles.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={() => request('grant')} disabled={busy}>Assign role</button>
          <button className="btn btn-secondary btn-small" onClick={() => request('revoke')} disabled={busy}>Remove role</button>
        </div>
        {notice && <p className="note-warn">{notice}</p>}
        {error && <p className="text-denied">{error}</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>QEA approvals</h2>
          <p className="muted small">{pending} pending · quorum {quorum}</p>
        </div>
        {data.changeRequests.length === 0 ? (
          <p className="muted">No change requests yet.</p>
        ) : (
          <table className="simple">
            <thead><tr><th>Change</th><th>Requested by</th><th>Approvals</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.changeRequests.map((cr) => {
                const youSigned = cr.authorizers.some((a) => a.username === data.you)
                const [chipClass, chipText] = STATUS_CHIP[cr.status]
                return (
                  <tr key={cr.id}>
                    <td>
                      <span className="mono small">{cr.actionType}</span>
                      <div><span className="mono">{cr.rows.role}</span> {cr.actionType === 'GRANT_ROLES' ? '→' : '✕'} <strong>{cr.rows.username}</strong></div>
                      <div className="muted small mono">{cr.id.slice(0, 8)}</div>
                    </td>
                    <td>{cr.requestedBy}<div className="muted small">{new Date(cr.createdAt).toLocaleString()}</div></td>
                    <td>
                      <strong>{cr.authorizers.length} of {cr.threshold}</strong>
                      <div className="muted small">{cr.authorizers.map((a) => a.username).join(', ') || 'none yet'}</div>
                    </td>
                    <td>
                      <span className={chipClass}>{chipText}</span>
                      {cr.denyReason && <div className="muted small">{cr.denyReason}</div>}
                    </td>
                    <td>
                      {cr.status === 'PENDING' && (
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            className="btn btn-secondary btn-small"
                            disabled={busy || youSigned}
                            onClick={() => act({ op: 'approve', id: cr.id }, (_s, b) => b.committed
                              ? `Quorum reached (${b.authorizationCount} of ${b.threshold}): the change is applied. ${cr.rows.username} gets it at their next login.`
                              : `Approval recorded: ${b.authorizationCount} of ${b.threshold}. Another admin must approve.`)}
                          >
                            {youSigned ? 'You approved' : 'Approve'}
                          </button>
                          <button
                            className="btn btn-secondary btn-small"
                            disabled={busy}
                            onClick={() => act({ op: 'deny', id: cr.id }, () => 'Change request denied. Nothing was applied.')}
                          >
                            Deny
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <p className="muted small">
        Each admin&apos;s approval counts once and comes from that admin&apos;s own token. To add another approval,
        log out and log in as a different admin. Simulated: real TideCloak has each admin sign the request in the
        Tide enclave.
      </p>
    </main>
  )
}
