// SIMULATED TideCloak and Tide network (Plan C). Server-only.
//
// Tide could not license realms during the hackathon, so this file stands in for
// two things, and only when TIDE_MODE is "simulated":
//
//   1. TideCloak: issues ES256-signed access tokens whose realm roles come from
//      the SAME init/realm.json that `npm run init` would import. The app verifies
//      them with the SDK's own verifyTideCloakToken, against simAdapterConfig().
//   2. The Tide network: wraps and unwraps a per-field data key, and refuses to
//      unwrap unless the signed token carries `_tide_<tag>.selfdecrypt`. The
//      browser encrypts and decrypts the value itself, so no ID value reaches
//      this server.
//
// Honest limits: one whole key (fabricSecret) sits in data/sim-tidecloak.json,
// which real Tide never allows (Tide invariant I-01: keys only ever exist as
// threshold shards across the network). There is no password and no quorum.

import crypto from "crypto"
import fs from "fs"
import path from "path"
import realm from "../init/realm.json"
import { tagRole } from "./cccd"

export const SIM_REALM = "leashed-id"
export const SIM_CLIENT = "leashed-id"
const SIM_AUTH_SERVER_URL = "http://localhost:3000/sim-tidecloak"
const TOKEN_LIFESPAN_SECONDS = 3600

const STATE_FILE = path.join(process.cwd(), "data", "sim-tidecloak.json")

type SimUser = { id: string; vuid: string; createdAt: string; grants: string[] }
type SimState = {
  signingKey: { kid: string; privateJwk: crypto.JsonWebKey; publicJwk: crypto.JsonWebKey }
  fabricSecret: string
  users: Record<string, SimUser>
}

// Route handlers are bundled separately, so the file on disk (not module state)
// is the one shared copy of the simulated realm.
function loadState(): SimState {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"))
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  const state: SimState = {
    signingKey: {
      kid: crypto.randomUUID(),
      privateJwk: privateKey.export({ format: "jwk" }),
      publicJwk: publicKey.export({ format: "jwk" }),
    },
    fabricSecret: crypto.randomBytes(32).toString("base64"),
    users: {},
  }
  saveState(state)
  return state
}

function saveState(state: SimState) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// Adapter config in the shape of tidecloak.json, with the public key embedded
// (Tide invariant I-04: verify against embedded JWKS, never a remote fetch).
export function simAdapterConfig() {
  const { kid, publicJwk } = loadState().signingKey
  return {
    realm: SIM_REALM,
    "auth-server-url": SIM_AUTH_SERVER_URL,
    "ssl-required": "external",
    resource: SIM_CLIENT,
    "public-client": true,
    "confidential-port": 0,
    jwk: { keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }] },
  }
}

type RealmRole = { name: string; composites?: { realm?: string[] } }

// The default composite from init/realm.json, expanded the way TideCloak does.
function defaultRealmRoles(): string[] {
  const byName = new Map((realm.roles.realm as RealmRole[]).map((r) => [r.name, r]))
  const out = new Set<string>()
  const expand = (name: string) => {
    for (const child of byName.get(name)?.composites?.realm ?? []) {
      if (!out.has(child)) { out.add(child); expand(child) }
    }
  }
  expand(realm.defaultRole.name)
  return [...out]
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url")

export class SimTideError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

// Sign in (or sign up) and get a token: what TideCloak's login does for the app.
export function issueSimToken(rawUsername: string) {
  const username = rawUsername.trim().toLowerCase()
  if (!/^[a-z0-9._-]{1,32}$/.test(username)) {
    throw new SimTideError("Username must be 1-32 characters: a-z, 0-9, dot, dash or underscore.", 400)
  }
  const state = loadState()
  let user = state.users[username]
  if (!user) {
    user = { id: crypto.randomUUID(), vuid: crypto.randomBytes(32).toString("hex"), createdAt: new Date().toISOString(), grants: [] }
    state.users[username] = user
    saveState(state)
  }

  const now = Math.floor(Date.now() / 1000)
  const roles = [...new Set([`default-roles-${SIM_REALM}`, "offline_access", ...defaultRealmRoles(), ...user.grants])]
  const payload = {
    exp: now + TOKEN_LIFESPAN_SECONDS,
    iat: now,
    jti: crypto.randomUUID(),
    iss: `${SIM_AUTH_SERVER_URL}/realms/${SIM_REALM}`,
    sub: user.id,
    typ: "Bearer",
    azp: SIM_CLIENT,
    preferred_username: username,
    vuid: user.vuid,
    tideuserkey: "SIMULATED",
    realm_access: { roles },
    sim: true,
  }
  const signingInput = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: state.signingKey.kid }))}.${b64url(JSON.stringify(payload))}`
  const privateKey = crypto.createPrivateKey({ key: state.signingKey.privateJwk, format: "jwk" })
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" })
  return { access_token: `${signingInput}.${b64url(signature)}`, token_type: "Bearer", expires_in: TOKEN_LIFESPAN_SECONDS }
}

type Claims = { vuid?: string; realm_access?: { roles?: string[] } }

// Self-encryption: the key is bound to the account (vuid) AND the tag, so another
// account, or another tag's ciphertext, cannot be unwrapped.
function fieldKey(vuid: string, tag: string) {
  return Buffer.from(crypto.hkdfSync("sha256", loadState().fabricSecret, vuid, `tide-sim:${tag}`, 32))
}

function requireRole(claims: Claims, role: string, refusal: string) {
  if (!claims.realm_access?.roles?.includes(role)) {
    throw new SimTideError(`SIMULATED Tide network: ${refusal}: token has no role ${role}`, 403)
  }
}

// doEncrypt: hand out a fresh data key and its wrapped form, if the token may encrypt this tag.
export function simWrapKey(claims: Claims, tag: string) {
  requireRole(claims, tagRole(tag, "selfencrypt"), "unauthorized")
  const vuid = String(claims.vuid)
  const dek = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", fieldKey(vuid, tag), iv)
  cipher.setAAD(Buffer.from(`${vuid}|${tag}`))
  const wrapped = Buffer.concat([iv, cipher.update(dek), cipher.final(), cipher.getAuthTag()])
  return { dek: dek.toString("base64"), wrapped: wrapped.toString("base64") }
}

// doDecrypt: unwrap the data key, only if the token holds the tag's decrypt role.
export function simUnwrapKey(claims: Claims, tag: string, wrappedB64: string) {
  requireRole(claims, tagRole(tag, "selfdecrypt"), "vendordecrypt voucher not allowed")
  const vuid = String(claims.vuid)
  try {
    const wrapped = Buffer.from(wrappedB64, "base64")
    const decipher = crypto.createDecipheriv("aes-256-gcm", fieldKey(vuid, tag), wrapped.subarray(0, 12))
    decipher.setAAD(Buffer.from(`${vuid}|${tag}`))
    decipher.setAuthTag(wrapped.subarray(wrapped.length - 16))
    const dek = Buffer.concat([decipher.update(wrapped.subarray(12, wrapped.length - 16)), decipher.final()])
    return { dek: dek.toString("base64") }
  } catch {
    throw new SimTideError(`SIMULATED Tide network: ciphertext is not bound to this account and tag ${tag}`, 400)
  }
}
