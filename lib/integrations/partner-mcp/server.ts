import "server-only";

/**
 * Redbloods Partner MCP connector — server binding. Returns null (→ every route answers 404) unless the
 * connector is explicitly enabled and fully configured. When disabled, nothing here touches the database —
 * production (PARTNER_MCP_ENABLED unset) stays inert even before the connector schema exists.
 *
 * The ONLY business capability wired in is the read-only Partner Gateway (brief / resolve / entity).
 */
import { readMcpConfig, type McpConfig } from "./config";
import { supabaseMcpStore } from "./store-supabase";
import { SlidingWindowLimiter } from "./rate-limit";
import { authenticateBearer, type OAuthDeps } from "./oauth";
import type { McpDeps } from "./mcp";
import type { McpStore } from "./store";

export interface McpRuntime { config: McpConfig; store: McpStore; oauth: OAuthDeps; mcp: McpDeps; allowRegistration(): boolean }

let limiter: SlidingWindowLimiter | null = null;
let rejectedLimiter: SlidingWindowLimiter | null = null;
let registrationLimiter: SlidingWindowLimiter | null = null;

export async function getMcpRuntime(): Promise<McpRuntime | null> {
  const c = readMcpConfig(process.env);
  if (!c.ok) {
    if (c.reason === "MISCONFIGURED") console.error("[partner-mcp] misconfigured — connector disabled:", c.detail);
    return null;
  }
  const config = c.config;
  const { supabase } = await import("@/lib/supabase");
  const { getPartnerBrief, resolvePartnerEntity, getPartnerEntity } = await import("@/lib/partner/gateway/server");
  const store = supabaseMcpStore(supabase);
  limiter ??= new SlidingWindowLimiter(config.rateLimit);
  rejectedLimiter ??= new SlidingWindowLimiter([{ windowMs: 60_000, max: 120 }]);
  registrationLimiter ??= new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 30 }]);
  const oauth: OAuthDeps = { config, store, nowSec: () => Math.floor(Date.now() / 1000) };
  const mcp: McpDeps = {
    config,
    authenticate: (h) => authenticateBearer(h, oauth),
    gateway: {
      brief: async () => (await getPartnerBrief()) as unknown as Record<string, unknown>,
      resolve: async (q) => (await resolvePartnerEntity(q)) as unknown as Record<string, unknown>,
      entity: async (k) => (await getPartnerEntity(k)) as unknown as Record<string, unknown>,
    },
    limiter,
    audit: (row) => store.writeAudit(row),
    auditRejected: async (row) => { if (rejectedLimiter!.allow("rejected", Date.now())) await store.writeAudit(row); },
    nowMs: () => Date.now(),
  };
  return { config, store, oauth, mcp, allowRegistration: () => registrationLimiter!.allow("register", Date.now()) };
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
