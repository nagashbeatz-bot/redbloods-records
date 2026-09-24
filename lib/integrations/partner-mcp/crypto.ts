/**
 * Redbloods Partner MCP connector — secrets and hashing. node:crypto only.
 *
 * What the client (Claude) receives: opaque random strings (256 bits) with a type prefix.
 * What the database stores: ONLY sha256(hex) of each code / access token / refresh token — never the value.
 * Lookup = hash the presented value, then find the row by its unique hash.
 */
import { createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = { access: "rbmcp_at_", refresh: "rbmcp_rt_", code: "rbmcp_ac_", client: "rbmcp_" } as const;

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomSecret(prefix: string, bytes = 32): string { return prefix + b64url(randomBytes(bytes)); }
export function newClientId(): string { return TOKEN_PREFIX.client + b64url(randomBytes(24)); }
export function sha256Hex(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }

/** RFC 7636: verifier = 43–128 unreserved chars; S256 challenge = base64url(sha256(verifier)). */
export const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export function pkceS256(verifier: string): string { return b64url(createHash("sha256").update(verifier, "ascii").digest()); }
