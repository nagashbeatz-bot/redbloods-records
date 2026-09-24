/**
 * Redbloods Partner MCP connector — "MCP-only" deployment mode for the STAGING service. Pure helpers.
 *
 * A staging service runs this same repository against the production data (read-only for business data).
 * REDBLOODS_MCP_ONLY=true turns it into a connector-only server, three independent layers:
 *   1. instrumentation.ts starts NO cron / report / push scheduler;
 *   2. proxy.ts answers 404 for every path except the connector, its OAuth endpoints, the Owner login and consent;
 *   3. a process-wide fetch guard lets the database see ONLY reads, plus the connector's own OAuth functions and
 *      audit inserts — any other write (a business table, an RPC, another host) throws before leaving the process.
 * Production never sets REDBLOODS_MCP_ONLY (unset = unchanged behaviour).
 */
export const MCP_PUBLIC_PATHS = [
  "/api/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
  "/.well-known/oauth-authorization-server",
  "/api/mcp-oauth/register",
  "/api/mcp-oauth/token",
  "/api/mcp-oauth/revoke",
] as const;

/** Exact-match only: these paths authenticate themselves (Bearer / PKCE) and are exempt from the cookie gate and the maintenance redirect. */
export function isMcpPublicPath(pathname: string): boolean {
  return (MCP_PUBLIC_PATHS as readonly string[]).includes(pathname);
}

/** The Owner consent page: exempt from the maintenance SCREEN only (never from the cookie auth gate). */
export const MCP_CONSENT_PATH = "/mcp-oauth/authorize";

/** In MCP-only mode, the only other reachable paths: Owner login + consent (cookie-authenticated as usual). */
const MCP_ONLY_EXTRA = ["/login", "/maintenance", "/api/maintenance/status", "/mcp-oauth/authorize", "/api/mcp-oauth/authorize"];
export function isAllowedInMcpOnlyMode(pathname: string): boolean {
  return isMcpPublicPath(pathname) || MCP_ONLY_EXTRA.includes(pathname);
}

export const isMcpOnlyMode = (env: Record<string, string | undefined>) => env.REDBLOODS_MCP_ONLY === "true";

/** Database writes the connector itself needs (OAuth state via its functions, audit inserts). Everything else: reads only. */
const WRITE_ALLOW = [
  /^\/rest\/v1\/rpc\/partner_mcp_(register_client|create_code|exchange_code|rotate_refresh|check_access|revoke_token)$/,
  /^\/rest\/v1\/partner_gateway_audit$/,
  /^\/auth\/v1\/token$/, // Owner session refresh (Supabase auth), never business data
];

/**
 * P1 (only when the deployment's answer switch is on): one more write — an INSERT into partner_owner_context (exact
 * path, POST only, never an upsert). Defense in depth, NOT authorization: the only code that reaches it is the existing
 * validated Owner Context store behind the Partner answer bridge. PATCH / DELETE / PUT stay blocked (and the DB
 * append-only triggers refuse UPDATE / DELETE anyway).
 */
const OWNER_CONTEXT_APPEND = /^\/rest\/v1\/partner_owner_context$/;

export function isAllowedMcpOnlyFetch(url: URL, method: string, dbHost: string, opts: { ownerContextAppend?: boolean } = {}): boolean {
  if (url.host !== dbHost) return false;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  if (m !== "POST") return false;
  if (WRITE_ALLOW.some((r) => r.test(url.pathname))) return true;
  return opts.ownerContextAppend === true && OWNER_CONTEXT_APPEND.test(url.pathname) && !url.searchParams.has("on_conflict");
}

/** Wraps globalThis.fetch so a disallowed request throws before leaving the process. Idempotent. */
export function installMcpOnlyFetchGuard(dbUrl: string, log: (msg: string) => void, opts: { ownerContextAppend?: boolean } = {}): void {
  const g = globalThis as typeof globalThis & { __rbMcpOnlyGuard?: boolean };
  if (g.__rbMcpOnlyGuard) return;
  const host = new URL(dbUrl).host;
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) || "GET";
    if (!isAllowedMcpOnlyFetch(url, method, host, opts)) {
      log(`[mcp-only] blocked ${method.toUpperCase()} ${url.host}${url.pathname}`);
      throw new Error("MCP-only mode: request blocked (read-only connector)");
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;
  g.__rbMcpOnlyGuard = true;
}
