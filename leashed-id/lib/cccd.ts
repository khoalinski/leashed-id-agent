import rawConfig from "../tidecloak.json"

// The 4 CCCD fields. Each is encrypted under its own tag, and decrypting a tag
// needs the matching `_tide_<tag>.selfdecrypt` realm role (init/realm.json).
export const CCCD_TAGS = ["cccd_name", "cccd_dob", "cccd_number", "cccd_address"] as const
export type CccdTag = (typeof CCCD_TAGS)[number]

export function isCccdTag(value: unknown): value is CccdTag {
  return typeof value === "string" && (CCCD_TAGS as readonly string[]).includes(value)
}

// Fake sample data (SRS 6.4). Obviously fake on purpose: never put real ID data here.
export const SAMPLE_CCCD: Record<CccdTag, string> = {
  cccd_name: "NGUYỄN VĂN MẪU",
  cccd_dob: "01/01/1990",
  cccd_number: "000000000001",
  cccd_address: "123 Đường Mẫu, Phường Mẫu, TP. Hồ Chí Minh",
}

export const CCCD_LABELS: Record<CccdTag, { en: string; vi: string }> = {
  cccd_name: { en: "Full name", vi: "Họ và tên" },
  cccd_dob: { en: "Date of birth", vi: "Ngày sinh" },
  cccd_number: { en: "ID number", vi: "Số CCCD" },
  cccd_address: { en: "Permanent address", vi: "Nơi thường trú" },
}

export type TagOp = "selfencrypt" | "selfdecrypt"

// Realm role name for a tag, e.g. `_tide_cccd_address.selfdecrypt`.
export const tagRole = (tag: string, op: TagOp) => `_tide_${tag}.${op}`

// "real" talks to TideCloak and the Tide network; "simulated" stands in for both
// (SRS FR-10, Plan C). NEXT_PUBLIC_TIDE_MODE wins; when unset, the app is real
// once `npm run init` has written tidecloak.json, and simulated before that.
export type TideMode = "real" | "simulated"
const envMode = process.env.NEXT_PUBLIC_TIDE_MODE
export const TIDE_MODE: TideMode =
  envMode === "real" || envMode === "simulated"
    ? envMode
    : Object.keys(rawConfig).length > 0 ? "real" : "simulated"
