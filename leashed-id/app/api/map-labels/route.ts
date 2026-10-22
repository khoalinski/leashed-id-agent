import { NextRequest, NextResponse } from 'next/server'
import { CCCD_TAGS, isCccdTag, type CccdTag } from '@/lib/cccd'
import type { FieldMapping, FormField, MapLabelsRequest, MapLabelsResponse } from '@/lib/hotelForm'

// Label mapping (FR-6): the LLM decides which CCCD tag each form field needs.
// It only ever sees labels and form text, never ID values, and the exact payload
// is returned as sentToLlm so the UI can prove it.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const LLM_TIMEOUT_MS = 8000 // leaves room for 4 decrypts inside NFR-7's 10 seconds

// SRS 6.5, verbatim. The injection is NOT in here: it reaches the model only
// through formText and the hidden field, as a real attack would.
const SYSTEM_PROMPT = `You map fields of an identity form to ID-card data tags.
Allowed tags: cccd_name (full name), cccd_dob (date of birth),
cccd_number (ID / citizen identification number), cccd_address
(permanent or home address). Use null for fields that are not ID data.
You only see labels and form text, never the person's data.
Respond with JSON only, no prose, no code fences:
{"mapping":[{"fieldId":"...","tag":"cccd_name"|...|null,"reason":"..."}]}
Include every field you were given exactly once.`

// Structured output schema, so the reply is always parseable JSON of that shape.
const MAPPING_SCHEMA = {
  type: 'object',
  properties: {
    mapping: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldId: { type: 'string' },
          tag: { anyOf: [{ type: 'string', enum: [...CCCD_TAGS] }, { type: 'null' }] },
          reason: { type: 'string' },
        },
        required: ['fieldId', 'tag', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['mapping'],
  additionalProperties: false,
}

// FR-6.5 keyword mapper, checked in this order.
const KEYWORDS: [CccdTag, RegExp][] = [
  ['cccd_number', /số\s*cccd|định\s*danh|cmnd|căn\s*cước/],
  ['cccd_dob', /ngày\s*sinh|năm\s*sinh/],
  ['cccd_address', /thường\s*trú|địa\s*chỉ|nơi\s*ở/],
  ['cccd_name', /họ|tên/],
]

function keywordMapping(fields: FormField[]): FieldMapping[] {
  return fields.map((f) => {
    const label = f.label.normalize('NFC').toLowerCase()
    const hit = KEYWORDS.find(([, re]) => re.test(label))
    return { fieldId: f.id, tag: hit ? hit[0] : null, reason: hit ? `keyword match /${hit[1].source}/` : 'no keyword matched' }
  })
}

function parseRequest(body: unknown): MapLabelsRequest | null {
  const b = body as Partial<MapLabelsRequest> | null
  if (!b || typeof b.formTitle !== 'string' || typeof b.formText !== 'string' || !Array.isArray(b.fields)) return null
  if (b.fields.length === 0 || b.fields.length > 50 || b.formText.length > 10_000) return null
  const fields = b.fields.filter((f): f is FormField => typeof f?.id === 'string' && typeof f?.label === 'string')
  if (fields.length !== b.fields.length) return null
  return { formTitle: b.formTitle, fields: fields.map(({ id, label }) => ({ id, label })), formText: b.formText }
}

// Every field exactly once, in form order; any tag outside the 4 known ones becomes null (FR-6.3).
function normalizeMapping(fields: FormField[], raw: unknown): FieldMapping[] {
  const entries = Array.isArray(raw) ? raw : []
  return fields.map((f) => {
    const entry = entries.find((e) => e?.fieldId === f.id)
    if (!entry) return { fieldId: f.id, tag: null, reason: 'Not returned by the model' }
    return {
      fieldId: f.id,
      tag: isCccdTag(entry.tag) ? entry.tag : null,
      reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 300) : '',
    }
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const req = parseRequest(await request.json().catch(() => null))
  if (!req) {
    return NextResponse.json({ error: 'Body must be { formTitle, fields: { id, label }[], formText }' }, { status: 400 })
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5'
  const payload = {
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(req, null, 2) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: MAPPING_SCHEMA } },
  }

  const fallback = (sentToLlm: unknown, llmError: string) =>
    NextResponse.json<MapLabelsResponse>({ mapping: keywordMapping(req.fields), source: 'fallback', sentToLlm, llmError })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallback(null, 'ANTHROPIC_API_KEY is not set, so nothing was sent to an LLM')

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${data?.error?.message ?? res.statusText}`)
    if (data.stop_reason !== 'end_turn') throw new Error(`LLM stopped with ${data.stop_reason}`)
    const text = (data.content as { type: string; text?: string }[])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const mapping = normalizeMapping(req.fields, JSON.parse(text).mapping)
    return NextResponse.json<MapLabelsResponse>({ mapping, source: 'llm', sentToLlm: payload })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[map-labels] LLM unavailable, using keyword mapper:', message)
    return fallback(payload, message)
  }
}
