/**
 * Redbloods Partner MCP connector — secrets and hashing. node:crypto only.
 *
 * What the client (Claude) receives: opaque random strings (256 bits) with a type prefix.
 * What the database stores: ONLY sha256(hex) of each code / access token / refresh token — never the value.
 * Lookup = hash the presented value, then find the row by its unique hash.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_PREFIX = { access: "rbmcp_at_", refresh: "rbmcp_rt_", code: "rbmcp_ac_", client: "rbmcp_" } as const;

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomSecret(prefix: string, bytes = 32): string { return prefix + b64url(randomBytes(bytes)); }
export function newClientId(): string { return TOKEN_PREFIX.client + b64url(randomBytes(24)); }
export function sha256Hex(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }

/** RFC 7636: verifier = 43–128 unreserved chars; S256 challenge = base64url(sha256(verifier)). */
export const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export function pkceS256(verifier: string): string { return b64url(createHash("sha256").update(verifier, "ascii").digest()); }

/** Constant-time string equality (for HMACs). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Consent CSRF token: HMAC over the exact authorization request AND the signed-in Owner's user id, with an
 * expiry. A form posted from another site, for another user, or with any parameter changed fails.
 */
export function signConsent(secret: string, fields: readonly string[], expiresAtSec: number): string {
  const mac = createHmac("sha256", secret).update(`consent-v1\n${expiresAtSec}\n${fields.join("\n")}`).digest("hex");
  return `${expiresAtSec}.${mac}`;
}
export function verifyConsent(secret: string, fields: readonly string[], token: string, nowSec: number): boolean {
  const m = /^(\d{10})\.([0-9a-f]{64})$/.exec(token ?? "");
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < nowSec) return false;
  return safeEqual(signConsent(secret, fields, exp), token);
}
