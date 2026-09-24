/**
 * Redbloods Partner MCP connector — Owner consent CSRF contract. Pure (node:crypto only).
 *
 * INTEGRATION LESSON (2026-09-24, first real Claude iOS connection): OAuth consent must support real Claude
 * mobile WebView behavior; browser fetch metadata alone is not sufficient proof of consent authenticity.
 * The consent form POST from our own page arrived with `Origin: null` (the page carried
 * `Referrer-Policy: no-referrer`, and per the Fetch spec a POST from such a document serializes its Origin as
 * "null" — in Safari/WebKit, Chromium and OAuth WebViews alike). An exact-Origin gate therefore refused the
 * Owner's genuine consent.
 *
 * The PRIMARY proof of consent authenticity is an explicit consent token:
 *   - 128-bit random id (jti), 5-minute expiry, SINGLE USE (consumed on the first decision, allow or deny);
 *   - HMAC-bound to the signed-in Owner's user id AND Supabase session id, and to the exact authorization
 *     request (client_id, redirect_uri, PKCE challenge, scope, resource, state);
 *   - only obtainable by reading our consent page (same-origin policy), which only the Owner's session renders.
 * Browser signals are SECONDARY, deny-only: a foreign Origin, a foreign Referer or Sec-Fetch-Site cross-site /
 * same-site is refused; an absent or "null" Origin is not decisive on its own. The session cookie is SameSite=Lax,
 * so a cross-site form POST does not even carry the Owner's session.
 * The OAuth `state` belongs to the client (Claude) and is never used as our CSRF token.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CONSENT_TTL_SECONDS = 300;

export interface ConsentBinding { userId: string; sessionId: string }

/** One-time consumption of consent token ids. Returns false when the id was already used. */
export interface ConsentReplayGuard { consume(jti: string, expSec: number, nowSec: number): boolean }

/** Process-local registry (single Railway instance; entries live until their token would have expired anyway). */
export class MemoryConsentReplayGuard implements ConsentReplayGuard {
  private used = new Map<string, number>();
  consume(jti: string, expSec: number, nowSec: number): boolean {
    for (const [k, e] of this.used) if (e < nowSec) this.used.delete(k);
    if (this.used.has(jti)) return false;
    this.used.set(jti, expSec);
    return true;
  }
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mac = (secret: string, jti: string, exp: number, b: ConsentBinding, fields: readonly string[]) =>
  createHmac("sha256", secret).update(["consent-v2", jti, String(exp), b.userId, b.sessionId, ...fields].join("\n")).digest("hex");

export function issueConsentToken(secret: string, b: ConsentBinding, fields: readonly string[], nowSec: number, ttl = CONSENT_TTL_SECONDS): string {
  const jti = b64url(randomBytes(16));
  const exp = nowSec + ttl;
  return `c2.${jti}.${exp}.${mac(secret, jti, exp, b, fields)}`;
}

export type ConsentVerdict = { ok: true; jti: string; exp: number } | { ok: false; reason: "MALFORMED" | "EXPIRED" | "BAD_MAC" | "NO_SESSION" };

/** Verifies format, expiry and the binding MAC (constant-time). Does NOT consume — the caller consumes after. */
export function verifyConsentToken(secret: string, b: ConsentBinding, fields: readonly string[], token: string, nowSec: number): ConsentVerdict {
  if (!b.userId || !b.sessionId) return { ok: false, reason: "NO_SESSION" };
  const m = /^c2\.([A-Za-z0-9_-]{22})\.(\d{10})\.([0-9a-f]{64})$/.exec(token ?? "");
  if (!m) return { ok: false, reason: "MALFORMED" };
  const exp = Number(m[2]);
  if (exp < nowSec) return { ok: false, reason: "EXPIRED" };
  const expected = Buffer.from(mac(secret, m[1], exp, b, fields), "utf8"), got = Buffer.from(m[3], "utf8");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: "BAD_MAC" };
  return { ok: true, jti: m[1], exp };
}

// ── request classification (safe to log: classes only, never values of cookies / codes / tokens) ──

export type OriginClass = "same" | "null" | "absent" | "foreign";
export interface ConsentRequestClass {
  origin: OriginClass;
  referer: "same" | "absent" | "foreign";
  secFetchSite: string | null;
  secFetchMode: string | null;
  secFetchDest: string | null;
  ua: "ios-webkit" | "android" | "desktop" | "other" | "absent";
}

export function classifyConsentRequest(header: (name: string) => string | null, baseUrl: string): ConsentRequestClass {
  const origin = header("origin");
  const referer = header("referer");
  const ua = header("user-agent");
  let refererClass: ConsentRequestClass["referer"] = "absent";
  if (referer) { try { refererClass = new URL(referer).origin === baseUrl ? "same" : "foreign"; } catch { refererClass = "foreign"; } }
  const short = (v: string | null) => (v && /^[a-z-]{1,20}$/.test(v) ? v : v ? "other" : null);
  return {
    origin: origin === null ? "absent" : origin === "null" ? "null" : origin === baseUrl ? "same" : "foreign",
    referer: refererClass,
    secFetchSite: short(header("sec-fetch-site")),
    secFetchMode: short(header("sec-fetch-mode")),
    secFetchDest: short(header("sec-fetch-dest")),
    ua: !ua ? "absent" : /iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) ? "ios-webkit" : /Android/.test(ua) ? "android" : /Windows|Macintosh|X11|Linux/.test(ua) ? "desktop" : "other",
  };
}

/** Deny-only browser signals. null = no definitive cross-site signal (the consent token still decides). */
export function crossSiteSignal(c: ConsentRequestClass): string | null {
  if (c.origin === "foreign") return "FOREIGN_ORIGIN";
  if (c.referer === "foreign") return "FOREIGN_REFERER";
  if (c.secFetchSite === "cross-site" || c.secFetchSite === "same-site") return "SEC_FETCH_SITE_CROSS";
  return null;
}
