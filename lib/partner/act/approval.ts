/**
 * SUNNY UNIVERSAL ACTION LAYER — approval tokens (pure, HMAC).
 *
 * A token binds: the plan hash (which covers every step / argument / entity / expected state / effect / risk / expiry),
 * the Owner, the connector client, the expiry and a one-time nonce. Any change → the hash no longer matches → refused.
 * Honest limit: in Claude, the Boss's "מאשר" reaches the server through Claude. Owner decision 2026-09-27: the Boss never
 * repeats values; the approval is bound to the exact plan hash (every value in the preview), so any change to the plan
 * voids it. Legacy tokens may still carry `v` (ignored — never required).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256 } from "./plan";

export const APPROVAL_TOKEN_TTL_MS = 10 * 60_000;
const TOKEN_RE = /^ak1\.([A-Za-z0-9_-]{20,1200})\.([A-Za-z0-9_-]{43})$/;
export interface ApprovalClaims { ph: string; o: string; c: string; exp: number; n: string; v?: string[] }
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(`ak1.${payload}`).digest("base64url");

export function issueApprovalToken(secret: string, o: { planHash: string; ownerId: string; clientId: string; nowMs: number; nonce?: string }): string {
  if (secret.length < 32) throw new Error("approval secret too short");
  const claims: ApprovalClaims = { ph: o.planHash, o: o.ownerId, c: o.clientId, exp: o.nowMs + APPROVAL_TOKEN_TTL_MS, n: o.nonce ?? randomBytes(16).toString("base64url") };
  const payload = b64(JSON.stringify(claims));
  return `ak1.${payload}.${mac(secret, payload)}`;
}

export type ApprovalRefusal = "TOKEN_MALFORMED" | "TOKEN_TAMPERED" | "TOKEN_EXPIRED" | "TOKEN_REPLAYED" | "WRONG_OWNER" | "WRONG_CLIENT" | "PLAN_MISMATCH";
/** One-time approval consumption. Production: a row in the approvals table (nonce primary key → a second use fails). */
export interface NonceConsumption { nonce: string; planId: string; planHash: string; ownerId: string; clientId: string; expMs: number }
export interface NonceStore { consume(c: NonceConsumption): Promise<boolean> }

export async function verifyApproval(secret: string, token: string, o: { planId: string; planHash: string; ownerId: string; clientId: string; nowMs: number; confirmationText: string; nonces: NonceStore }): Promise<{ ok: true; claims: ApprovalClaims } | { ok: false; refusal: ApprovalRefusal }> {
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
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(c.n))) return { ok: false, refusal: "TOKEN_MALFORMED" };
  if (!(await o.nonces.consume({ nonce: c.n, planId: o.planId, planHash: o.planHash, ownerId: o.ownerId, clientId: o.clientId, expMs: c.exp }))) return { ok: false, refusal: "TOKEN_REPLAYED" };
  return { ok: true, claims: c };
}

// ── duplicate acknowledgement (POSSIBLE_DUPLICATE → the Boss said "a separate record") ─────────────────────────────
/**
 * `separateFromSimilar: true` is never usable blindly. A POSSIBLE_DUPLICATE / POSSIBLE_DUPLICATE_IN_PLAN refusal returns
 * a `duplicateAck` bound (HMAC, key derived from the approval secret, domain-separated) to: the Owner, the connector
 * client, the action id, the canonical arguments (minus separateFromSimilar / duplicateAck) and the CURRENT similar-record
 * subject (the live creation-context fingerprint + the in-plan candidates), with an expiry. A re-plan with
 * separateFromSimilar: true must carry a valid, unexpired ack for exactly that — a new similar record, other arguments,
 * another action / owner / client, a forged or expired ack → DUPLICATE_ACK_REQUIRED.
 * Format: dack1.<expiry ms>.<64-hex>. It authorises nothing by itself (the plan still needs the Boss's approval).
 */
export const DUPLICATE_ACK_TTL_MS = 15 * 60_000;
export const DUPLICATE_ACK_RE = /^dack1\.(\d{13})\.([0-9a-f]{64})$/;
export const DUP_ACK_ARG_NAMES = ["separateFromSimilar", "duplicateAck"] as const;
export interface DuplicateAckSubject { ownerId: string; clientId: string; actionId: string; args: Readonly<Record<string, unknown>>; similar: string }
const ackArgs = (a: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.entries(a).filter(([k]) => !(DUP_ACK_ARG_NAMES as readonly string[]).includes(k)));
const ackMac = (secret: string, s: DuplicateAckSubject, exp: number) =>
  createHmac("sha256", sha256(`redbloods-dup-ack-v1:${secret}`)).update(`dack1|${s.ownerId}|${s.clientId}|${s.actionId}|${sha256(canonicalJson(ackArgs(s.args)))}|${sha256(s.similar)}|${exp}`).digest("hex");

export function issueDuplicateAck(secret: string, s: DuplicateAckSubject, nowMs: number): { duplicateAck: string; expiresAt: string } {
  if (secret.length < 32) throw new Error("approval secret too short");
  const exp = nowMs + DUPLICATE_ACK_TTL_MS;
  return { duplicateAck: `dack1.${exp}.${ackMac(secret, s, exp)}`, expiresAt: new Date(exp).toISOString() };
}
export type DuplicateAckRefusal = "ACK_MISSING" | "ACK_MALFORMED" | "ACK_EXPIRED" | "ACK_MISMATCH";
export function verifyDuplicateAck(secret: string, ack: unknown, s: DuplicateAckSubject, nowMs: number): { ok: true } | { ok: false; refusal: DuplicateAckRefusal } {
  if (ack === undefined || ack === null || ack === "") return { ok: false, refusal: "ACK_MISSING" };
  const m = typeof ack === "string" ? DUPLICATE_ACK_RE.exec(ack) : null;
  if (!m) return { ok: false, refusal: "ACK_MALFORMED" };
  const exp = Number(m[1]);
  const want = Buffer.from(ackMac(secret, s, exp)), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, refusal: "ACK_MISMATCH" };
  if (nowMs > exp || exp - nowMs > DUPLICATE_ACK_TTL_MS) return { ok: false, refusal: "ACK_EXPIRED" };
  return { ok: true };
}
