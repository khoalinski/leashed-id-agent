import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { CCCD_TAGS, type CccdTag, type VaultRecord } from '@/lib/cccd'
import { bearerToken, verifyToken } from '@/lib/tideServer'

// The vault (FR-3): one record of CCCD ciphertexts per account, keyed by the
// token's vuid. It never sees plaintext, and never logs values beyond their length.

const ALLOWED_ROLE = 'offline_access'
const VAULT_FILE = path.join(process.cwd(), 'data', 'vault.json')
const MAX_CIPHERTEXT_LENGTH = 20_000

type VaultFile = Record<string, VaultRecord>

function readVault(): VaultFile {
  return fs.existsSync(VAULT_FILE) ? JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8')) : {}
}

function writeVault(vault: VaultFile) {
  fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true })
  const tmp = `${VAULT_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2))
  fs.renameSync(tmp, VAULT_FILE)
}

// Same check as the generator's app/api/protected/route.ts.
async function authorize(request: NextRequest): Promise<{ vuid: string } | NextResponse> {
  const token = bearerToken(request)
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 })
  }
  const user = await verifyToken(token, [ALLOWED_ROLE])
  if (!user?.vuid) {
    return NextResponse.json({ error: 'Forbidden: Invalid token or insufficient role' }, { status: 403 })
  }
  return { vuid: String(user.vuid) }
}

// Exactly the 4 known tags, each a non-empty string (FR-3.4).
function parseFields(body: unknown): Record<CccdTag, string> | null {
  const fields = (body as { fields?: unknown } | null)?.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null
  const keys = Object.keys(fields)
  if (keys.length !== CCCD_TAGS.length || !CCCD_TAGS.every((tag) => keys.includes(tag))) return null
  const values = fields as Record<string, unknown>
  for (const tag of CCCD_TAGS) {
    const v = values[tag]
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_CIPHERTEXT_LENGTH) return null
  }
  return values as Record<CccdTag, string>
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ record: readVault()[auth.vuid] ?? null })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request)
  if (auth instanceof NextResponse) return auth

  const fields = parseFields(await request.json().catch(() => null))
  if (!fields) {
    return NextResponse.json(
      { error: `Body must be { fields } with exactly the tags ${CCCD_TAGS.join(', ')}, each a non-empty string` },
      { status: 400 }
    )
  }

  const record: VaultRecord = { vuid: auth.vuid, updatedAt: new Date().toISOString(), fields }
  const vault = readVault()
  vault[auth.vuid] = record
  writeVault(vault)
  console.info('[vault] saved record', auth.vuid.slice(0, 8), CCCD_TAGS.map((tag) => `${tag}:${fields[tag].length}`).join(' '))
  return NextResponse.json({ ok: true, record })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request)
  if (auth instanceof NextResponse) return auth
  const vault = readVault()
  if (vault[auth.vuid]) {
    delete vault[auth.vuid]
    writeVault(vault)
  }
  return NextResponse.json({ ok: true })
}
