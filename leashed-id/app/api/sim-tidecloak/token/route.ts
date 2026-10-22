import { NextRequest, NextResponse } from 'next/server'
import { TIDE_MODE } from '@/lib/cccd'
import { issueSimToken, SimTideError } from '@/lib/simTide'

// SIMULATED TideCloak token endpoint (Plan C). Gone in real mode.
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (TIDE_MODE !== 'simulated') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(issueSimToken(String(body?.username ?? '')), { status: 200 })
  } catch (err) {
    if (err instanceof SimTideError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
