// Server-side token checks, the same in both modes: the SDK's verifyTideCloakToken
// (the pattern in app/api/protected/route.ts), against tidecloak.json in real mode
// or the simulated realm's adapter config in simulated mode.

import { verifyTideCloakToken } from "@tidecloak/nextjs/server"
import tcConfig from "../tidecloak.json"
import { TIDE_MODE } from "./cccd"
import { simAdapterConfig } from "./simTide"

export function tideConfig(): object {
  return TIDE_MODE === "real" ? tcConfig : simAdapterConfig()
}

export function bearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization")
  return authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null
}

// Returns the verified token payload, or null if the token is invalid or lacks every allowed role.
export async function verifyToken(token: string, allowedRoles: string[]): Promise<Record<string, any> | null> {
  return (await verifyTideCloakToken(tideConfig(), token, allowedRoles)) as Record<string, any> | null
}
