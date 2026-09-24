import "server-only";

/**
 * Redbloods Partner MCP connector — server binding. Returns null (→ every route answers 404) unless the
 * connector is explicitly enabled and fully configured. When disabled, nothing here touches the database —
 * production (PARTNER_MCP_ENABLED unset) stays inert even before the connector schema exists.
 *
 * The ONLY business capability wired in is the read-only Partner Gateway (brief / resolve / entity / query).
 *
 * Audience: EXTERNAL with the Owner's authority. A partner:read token can only exist after the Owner approved the
 * consent screen (decideAuthorization refuses NOT_OWNER), so every authenticated connector call carries the Owner's
 * grant. INTERNAL-only knowledge capabilities are never served here (the Gateway's registry refuses them).
 */
import { readMcpConfig, type McpConfig } from "./config";
import { supabaseMcpStore } from "./store-supabase";
import { SlidingWindowLimiter } from "./rate-limit";
import { authenticateBearer, type ConsentSession, type OAuthDeps } from "./oauth";
import { MemoryConsentReplayGuard } from "./consent";
import type { McpDeps } from "./mcp";
import type { McpStore } from "./store";

export interface McpRuntime { config: McpConfig; store: McpStore; oauth: OAuthDeps; mcp: McpDeps; allowRegistration(): boolean }

/** Remote interface, carrying the Owner's grant (see the module doc). */
const MCP_AUDIENCE = { channel: "EXTERNAL", ownerAuthorized: true } as const;

let limiter: SlidingWindowLimiter | null = null;
let rejectedLimiter: SlidingWindowLimiter | null = null;
let registrationLimiter: SlidingWindowLimiter | null = null;
const consentReplay = new MemoryConsentReplayGuard();

export async function getMcpRuntime(): Promise<McpRuntime | null> {
  const c = readMcpConfig(process.env);
  if (!c.ok) {
    if (c.reason === "MISCONFIGURED") console.error("[partner-mcp] misconfigured — connector disabled:", c.detail);
    return null;
  }
  const config = c.config;
  const { supabase } = await import("@/lib/supabase");
  const { getPartnerBrief, resolvePartnerEntity, getPartnerEntity, queryPartnerKnowledge, describePartnerKnowledge } = await import("@/lib/partner/gateway/server");
  const store = supabaseMcpStore(supabase);
  limiter ??= new SlidingWindowLimiter(config.rateLimit);
  rejectedLimiter ??= new SlidingWindowLimiter([{ windowMs: 60_000, max: 120 }]);
  registrationLimiter ??= new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 30 }]);
  const oauth: OAuthDeps = { config, store, nowSec: () => Math.floor(Date.now() / 1000), consentReplay };
  const mcp: McpDeps = {
    config,
    authenticate: (h) => authenticateBearer(h, oauth),
    gateway: {
      brief: async () => (await getPartnerBrief(undefined, MCP_AUDIENCE)) as unknown as Record<string, unknown>,
      resolve: async (q) => (await resolvePartnerEntity(q)) as unknown as Record<string, unknown>,
      entity: async (k) => (await getPartnerEntity(k, undefined, MCP_AUDIENCE)) as unknown as Record<string, unknown>,
      query: async (a) => (await queryPartnerKnowledge(a, MCP_AUDIENCE)) as unknown as Record<string, unknown>,
      capabilityIndex: () => describePartnerKnowledge(MCP_AUDIENCE),
    },
    limiter,
    audit: (row) => store.writeAudit(row),
    auditRejected: async (row) => { if (rejectedLimiter!.allow("rejected", Date.now())) await store.writeAudit(row); },
    nowMs: () => Date.now(),
  };
  return { config, store, oauth, mcp, allowRegistration: () => registrationLimiter!.allow("register", Date.now()) };
}

/**
 * The signed-in Redbloods user for the consent step, from SIGNATURE-VERIFIED session claims (user id + Supabase
 * session id + owner role). null when there is no valid session — the consent token is bound to both ids.
 */
export async function getConsentSession(): Promise<ConsentSession | null> {
  try {
    const { createSupabaseServer } = await import("@/lib/supabase-server");
    const { roleForEmail } = await import("@/lib/roles");
    const sb = await createSupabaseServer();
    const { data, error } = await sb.auth.getClaims();
    const c = (data?.claims ?? null) as { sub?: unknown; session_id?: unknown; email?: unknown } | null;
    if (error || !c || typeof c.sub !== "string" || typeof c.session_id !== "string" || !c.sub || !c.session_id) return null;
    return { userId: c.sub, sessionId: c.session_id, isOwner: roleForEmail(typeof c.email === "string" ? c.email : null) === "owner" };
  } catch {
    return null;
  }
}

/** The standard "not here" answer for a disabled connector (no hint that a connector exists). */
export const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** OAuth form body (application/x-www-form-urlencoded, ≤ 8 KB). A repeated parameter is invalid (RFC 6749 §3.1). */
export async function readOAuthForm(req: Request): Promise<Record<string, string> | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const text = await req.text();
  if (text.length > 8192) return null;
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params) { if (k in out) return null; out[k] = v; }
  return out;
}

export function toResponse(o: { status: number; headers: Record<string, string>; body: string | null }): Response {
  return new Response(o.body, { status: o.status, headers: o.headers });
}
