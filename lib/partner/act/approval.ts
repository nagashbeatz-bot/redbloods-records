/**
 * SUNNY UNIVERSAL ACTION LAYER — approval tokens (pure, HMAC).
 *
 * A token binds: the plan hash (which covers every step / argument / entity / expected state / effect / risk / expiry),
 * the Owner, the connector client, the expiry and a one-time nonce. Any change → the hash no longer matches → refused.
 * Honest limit: in Claude, the Boss's "כן" reaches the server through Claude. C2 binds the confirmation to the exact
 * values in the preview; C3 is designed for a channel Claude cannot forge (configurable — not built in Wave 0).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const APPROVAL_TOKEN_TTL_MS = 10 * 60_000;
const TOKEN_RE = /^ak1\.([A-Za-z0-9_-]{20,1200})\.([A-Za-z0-9_-]{43})$/;
export interface ApprovalClaims { ph: string; o: string; c: string; exp: number; n: string; v: string[] }
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(`ak1.${payload}`).digest("base64url");

export function issueApprovalToken(secret: string, o: { planHash: string; ownerId: string; clientId: string; nowMs: number; requiredValues?: readonly string[]; nonce?: string }): string {
  if (secret.length < 32) throw new Error("approval secret too short");
  const claims: ApprovalClaims = { ph: o.planHash, o: o.ownerId, c: o.clientId, exp: o.nowMs + APPROVAL_TOKEN_TTL_MS, n: o.nonce ?? randomBytes(16).toString("base64url"), v: [...(o.requiredValues ?? [])] };
  const payload = b64(JSON.stringify(claims));
  return `ak1.${payload}.${mac(secret, payload)}`;
}

export type ApprovalRefusal = "TOKEN_MALFORMED" | "TOKEN_TAMPERED" | "TOKEN_EXPIRED" | "TOKEN_REPLAYED" | "WRONG_OWNER" | "WRONG_CLIENT" | "PLAN_MISMATCH" | "CONFIRMATION_VALUES_MISSING";
export interface NonceStore { consume(nonce: string, expMs: number): Promise<boolean> }

export async function verifyApproval(secret: string, token: string, o: { planHash: string; ownerId: string; clientId: string; nowMs: number; confirmationText: string; nonces: NonceStore }): Promise<{ ok: true; claims: ApprovalClaims } | { ok: false; refusal: ApprovalRefusal }> {
  const m = TOKEN_RE.exec(token);
  if (!m) return { ok: false, refusal: "TOKEN_MALFORMED" };
  const want = Buffer.from(mac(secret, m[1])), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, refusal: "TOKEN_TAMPERED" };
  let c: ApprovalClaims;
  try { c = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as ApprovalClaims; } catch { return { ok: false, refusal: "TOKEN_MALFORMED" }; }
  if (typeof c.exp !== "number" || o.nowMs > c.exp) return { ok: false, refusal: "TOKEN_EXPIRED" };
  if (c.o !== o.ownerId) return { ok: false, refusal: "WRONG_OWNER" };
  if (c.c !== o.clientId) return { ok: false, refusal: "WRONG_CLIENT" };
  if (c.ph !== o.planHash) return { ok: false, refusal: "PLAN_MISMATCH" };
  const text = o.confirmationText.normalize("NFKC");
  if ((c.v ?? []).some((v) => !text.includes(v.normalize("NFKC")))) return { ok: false, refusal: "CONFIRMATION_VALUES_MISSING" };
  if (!(await o.nonces.consume(c.n, c.exp))) return { ok: false, refusal: "TOKEN_REPLAYED" };
  return { ok: true, claims: c };
}
