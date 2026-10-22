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
//   3. Quorum approvals (QEA): a role change made by an admin becomes a PENDING
//      change request, and applies only once enough admins approve it.
//
// Honest limits: one whole key (fabricSecret) sits in data/sim-tidecloak.json,
// which real Tide never allows (Tide invariant I-01: keys only ever exist as
// threshold shards across the network). There is no password, and approvals
// are recorded, not signed in a Tide enclave.

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

// The simulated realm's admins. As in TideCloak, they hold the realm-management
// client role tide-realm-admin, and the MultiAdmin quorum is
// max(1, floor(0.7 × admins)): 2 of 3.
export const SIM_ADMINS = ["admin1", "admin2", "admin3"]
export const SIM_THRESHOLD = Math.max(1, Math.floor(0.7 * SIM_ADMINS.length))
const ADMIN_CLIENT = "realm-management"
const ADMIN_ROLE = "tide-realm-admin"

type SimUser = { id: string; vuid: string; createdAt: string; grants: string[] }

// Field names follow TideCloak's /iga/change-requests objects. APPROVED means applied.
export type SimChangeRequest = {
  id: string
  entityType: "USER"
  entityId: string
  actionType: "GRANT_ROLES" | "REVOKE_ROLES"
  status: "PENDING" | "APPROVED" | "DENIED"
  requestedBy: string
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
  rows: { username: string; role: string }
  authorizers: { username: string; timestamp: string }[]
  threshold: number
  denyReason?: string
}

type SimState = {
  signingKey: { kid: string; privateJwk: crypto.JsonWebKey; publicJwk: crypto.JsonWebKey }
  fabricSecret: string
  users: Record<string, SimUser>
  changeRequests: SimChangeRequest[]
}

// Route handlers are bundled separately, so the file on disk (not module state)
// is the one shared copy of the simulated realm.
function loadState(): SimState {
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"))
    return { ...state, changeRequests: state.changeRequests ?? [] }
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  const state: SimState = {
    signingKey: {
      kid: crypto.randomUUID(),
      privateJwk: privateKey.export({ format: "jwk" }),
      publicJwk: publicKey.export({ format: "jwk" }),
    },
    fabricSecret: crypto.randomBytes(32).toString("base64"),
    users: {},
    changeRequests: [],
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
    ...(SIM_ADMINS.includes(username) && {
      resource_access: { [ADMIN_CLIENT]: { roles: [ADMIN_ROLE, "manage-realm"] } },
    }),
    sim: true,
  }
  const signingInput = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: state.signingKey.kid }))}.${b64url(JSON.stringify(payload))}`
  const privateKey = crypto.createPrivateKey({ key: state.signingKey.privateJwk, format: "jwk" })
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" })
  return { access_token: `${signingInput}.${b64url(signature)}`, token_type: "Bearer", expires_in: TOKEN_LIFESPAN_SECONDS }
}

type Claims = {
  vuid?: string
  preferred_username?: string
  realm_access?: { roles?: string[] }
  resource_access?: Record<string, { roles?: string[] }>
}

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

// ─── Quorum approvals (QEA) ──────────────────────────────────────────────────

function requireAdmin(claims: Claims): string {
  if (!claims.resource_access?.[ADMIN_CLIENT]?.roles?.includes(ADMIN_ROLE)) {
    throw new SimTideError(`Forbidden: only realm admins (${SIM_ADMINS.join(", ")}) can manage roles and change requests`, 403)
  }
  return String(claims.preferred_username)
}

// Plain realm roles an admin can grant: everything in init/realm.json except composites.
function assignableRoles(): string[] {
  return (realm.roles.realm as RealmRole[]).filter((r) => !r.composites).map((r) => r.name)
}

export function simRealmOverview(claims: Claims) {
  const you = requireAdmin(claims)
  const state = loadState()
  return {
    you,
    admins: SIM_ADMINS,
    threshold: SIM_THRESHOLD,
    roles: assignableRoles(),
    users: Object.entries(state.users).map(([username, u]) => ({ username, admin: SIM_ADMINS.includes(username), grants: u.grants })),
    changeRequests: [...state.changeRequests].reverse(),
  }
}
export type SimRealmOverview = ReturnType<typeof simRealmOverview>

// An admin's role change does not apply: it is captured as a PENDING change request (TideCloak answers 202).
export function simRequestRoleChange(claims: Claims, actionType: SimChangeRequest["actionType"], username: string, role: string) {
  const admin = requireAdmin(claims)
  const state = loadState()
  const user = state.users[username]
  if (!user) throw new SimTideError(`No user ${username}: they need to sign in once first`, 404)
  if (!assignableRoles().includes(role)) throw new SimTideError(`Unknown realm role ${role}`, 400)
  if (actionType === "GRANT_ROLES" && (defaultRealmRoles().includes(role) || user.grants.includes(role))) {
    throw new SimTideError(`${username} already holds ${role}`, 409)
  }
  if (actionType === "REVOKE_ROLES" && !user.grants.includes(role)) {
    throw new SimTideError(`${role} was never granted to ${username}${defaultRealmRoles().includes(role) ? " (it comes from the default roles)" : ""}`, 409)
  }
  const conflict = state.changeRequests.find((cr) => cr.status === "PENDING" && cr.entityId === user.id)
  if (conflict) {
    throw new SimTideError(`PENDING_CHANGE_REQUEST_CONFLICT: ${username} already has pending change request ${conflict.id}`, 409)
  }
  const cr: SimChangeRequest = {
    id: crypto.randomUUID(),
    entityType: "USER",
    entityId: user.id,
    actionType,
    status: "PENDING",
    requestedBy: admin,
    createdAt: new Date().toISOString(),
    rows: { username, role },
    authorizers: [],
    threshold: SIM_THRESHOLD,
  }
  state.changeRequests.push(cr)
  saveState(state)
  return cr
}

// Credited to the calling admin, once each; applies the change when the quorum is met.
export function simApproveChangeRequest(claims: Claims, id: string) {
  const admin = requireAdmin(claims)
  const state = loadState()
  const cr = state.changeRequests.find((c) => c.id === id)
  if (!cr) throw new SimTideError(`No change request ${id}`, 404)
  if (cr.status !== "PENDING") throw new SimTideError(`Change request is ${cr.status}, not PENDING`, 409)
  if (cr.authorizers.some((a) => a.username === admin)) throw new SimTideError(`${admin} already approved this change request`, 409)

  cr.authorizers.push({ username: admin, timestamp: new Date().toISOString() })
  const committed = cr.authorizers.length >= cr.threshold
  if (committed) {
    const user = state.users[cr.rows.username]
    user.grants = cr.actionType === "GRANT_ROLES"
      ? [...new Set([...user.grants, cr.rows.role])]
      : user.grants.filter((r) => r !== cr.rows.role)
    cr.status = "APPROVED"
    cr.resolvedAt = new Date().toISOString()
    cr.resolvedBy = admin
  }
  saveState(state)
  return { mode: "recorded", committed, authorizationCount: cr.authorizers.length, threshold: cr.threshold, status: cr.status }
}

// Unlike TideCloak's deny, this refuses anything but a PENDING request, so it can never relabel an applied change.
export function simDenyChangeRequest(claims: Claims, id: string, reason: string) {
  const admin = requireAdmin(claims)
  const state = loadState()
  const cr = state.changeRequests.find((c) => c.id === id)
  if (!cr) throw new SimTideError(`No change request ${id}`, 404)
  if (cr.status !== "PENDING") throw new SimTideError(`Change request is ${cr.status}, not PENDING`, 409)
  cr.status = "DENIED"
  cr.resolvedAt = new Date().toISOString()
  cr.resolvedBy = admin
  cr.denyReason = reason.slice(0, 300) || undefined
  saveState(state)
  return cr
}
