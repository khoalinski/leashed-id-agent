import { NextRequest, NextResponse } from 'next/server'
import { TIDE_MODE } from '@/lib/cccd'
import { simUnwrapKey, simWrapKey, SimTideError } from '@/lib/simTide'
import { bearerToken, verifyToken } from '@/lib/tideServer'

// SIMULATED Tide network (Plan C). Gone in real mode, where the browser SDK talks
// to Tide's network directly. It only ever handles data keys, never ID values.
//   { op: "encrypt", tag }                  -> { dek, wrapped }
//   { op: "decrypt", tag, tags, wrapped }   -> { dek }
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (TIDE_MODE !== 'simulated') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const token = bearerToken(request)
  const claims = token ? await verifyToken(token, []) : null
  if (!claims) {
    return NextResponse.json({ error: 'SIMULATED Tide network: invalid or expired token. Log in again.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const tag = typeof body?.tag === 'string' ? body.tag : ''
  try {
    if (body?.op === 'encrypt' && tag) {
      return NextResponse.json(simWrapKey(claims, tag))
    }
    if (body?.op === 'decrypt' && tag && typeof body.wrapped === 'string' && Array.isArray(body.tags)) {
      if (!body.tags.includes(tag)) {
        throw new SimTideError(`SIMULATED Tide network: ciphertext tag ${tag} is not in the requested tags`, 400)
      }
      return NextResponse.json(simUnwrapKey(claims, tag, body.wrapped))
    }
    return NextResponse.json({ error: 'SIMULATED Tide network: malformed request' }, { status: 400 })
  } catch (err) {
    if (err instanceof SimTideError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
