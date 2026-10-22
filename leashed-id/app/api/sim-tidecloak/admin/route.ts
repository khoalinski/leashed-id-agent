import { NextRequest, NextResponse } from 'next/server'
import { TIDE_MODE } from '@/lib/cccd'
import {
  simApproveChangeRequest,
  simDenyChangeRequest,
  simRealmOverview,
  simRequestRoleChange,
  SimTideError,
} from '@/lib/simTide'
import { bearerToken, verifyToken } from '@/lib/tideServer'

// SIMULATED TideCloak admin API for quorum approvals (Plan C). Gone in real mode,
// where the TideCloak admin console does this. Every call carries the admin's
// own token, so each approval is credited to that admin, as in TideCloak.
//   GET                                   -> realm overview + change requests
//   POST { op: "grant" | "revoke", username, role }  -> 202, a PENDING change request
//   POST { op: "approve", id }            -> { mode, committed, authorizationCount, threshold, status }
//   POST { op: "deny", id, reason? }      -> the DENIED change request

async function claimsFor(request: NextRequest) {
  const token = bearerToken(request)
  return token ? verifyToken(token, []) : null
}

function handle(fn: () => NextResponse): NextResponse {
  try {
    return fn()
  } catch (err) {
    if (err instanceof SimTideError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (TIDE_MODE !== 'simulated') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const claims = await claimsFor(request)
  if (!claims) return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 })
  return handle(() => NextResponse.json(simRealmOverview(claims)))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (TIDE_MODE !== 'simulated') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const claims = await claimsFor(request)
  if (!claims) return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return handle(() => {
    switch (body?.op) {
      case 'grant':
      case 'revoke': {
        const action = body.op === 'grant' ? 'GRANT_ROLES' : 'REVOKE_ROLES'
        const cr = simRequestRoleChange(claims, action, str(body.username), str(body.role))
        return NextResponse.json({ changeRequest: cr }, { status: 202 })
      }
      case 'approve':
        return NextResponse.json(simApproveChangeRequest(claims, str(body.id)))
      case 'deny':
        return NextResponse.json({ changeRequest: simDenyChangeRequest(claims, str(body.id), str(body.reason)) })
      default:
        return NextResponse.json({ error: 'op must be grant, revoke, approve or deny' }, { status: 400 })
    }
  })
}
