/**
 * The OAuth lifecycle + threat scenario suite for the Redbloods Partner MCP connector. Store-agnostic:
 *   - scripts/test-partner-mcp.tsx runs it on the in-memory mirror (fast, every regression run);
 *   - the Docker harness runs it on the REAL candidate migration (mcp-oauth-final.sql) with true parallelism.
 * It drives the real OAuth core (registration → consent → code → token → bearer → refresh → revoke).
 */
import { readMcpConfig, type McpConfig } from "../../lib/integrations/partner-mcp/config";
import { pkceS256 } from "../../lib/integrations/partner-mcp/crypto";
import { authenticateBearer, consentToken, decideAuthorization, registerClientCore, revokeCore, tokenCore, validateAuthorizeRequest, type OAuthDeps } from "../../lib/integrations/partner-mcp/oauth";
import type { McpStore } from "../../lib/integrations/partner-mcp/store";
import { MemoryConsentReplayGuard } from "../../lib/integrations/partner-mcp/consent";

export interface ScenarioHooks { ageUnusedClients(): Promise<void> | void; expireAccess(): Promise<void> | void; expireRefresh(): Promise<void> | void; expireCodes(): Promise<void> | void; disableClient(id: string): Promise<void> | void; revokeAll(): Promise<number> | number; activeTokens(): Promise<number> | number }
export type Check = (name: string, actual: unknown, expected: unknown) => void;

export const BASE_ENV = { PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://partner-staging.example.com", PARTNER_MCP_SECRET: "s".repeat(48) };
export const OWNER = "0f0f0f0f-0000-4000-8000-00000000a0a0";
export const OWNER_SESSION = "5e55e55e-0000-4000-8000-0000000000aa";
export const OWNER_BINDING = { userId: OWNER, sessionId: OWNER_SESSION };
export const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const VERIFIER = "v".repeat(20) + "-._~" + "A1b2C3d4E5f6G7h8I9j0K1l2"; // 48 chars, RFC 7636 alphabet

export function testConfig(over: Partial<McpConfig> = {}, env: Record<string, string> = BASE_ENV): McpConfig {
  const c = readMcpConfig(env);
  if (!c.ok) throw new Error(c.detail);
  return { ...c.config, maxActiveClients: 3, ...over };
}

export async function runOAuthScenarios(store: McpStore, hooks: ScenarioHooks, check: Check, label = "") {
  const nowSec = { v: Math.floor(Date.now() / 1000) };
  const deps: OAuthDeps = { config: testConfig(), store, nowSec: () => nowSec.v, consentReplay: new MemoryConsentReplayGuard() };
  const L = (s: string) => `${label}${s}`;
  const form = (o: Record<string, string>) => o;
  const body = (o: { body: string | null }) => (o.body ? JSON.parse(o.body) : null);

  // ── registration ──
  const reg = await registerClientCore({ client_name: "Claude", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none", response_types: ["code"] }, deps);
  const clientId: string = body(reg).client_id;
  check(L("G. DCR: a public PKCE client with Claude's callback registers (201, auth method none)"), [reg.status, /^rbmcp_[A-Za-z0-9_-]{32}$/.test(clientId), body(reg).token_endpoint_auth_method], [201, true, "none"]);
  const bad = await Promise.all([
    registerClientCore({ redirect_uris: ["https://evil.example/cb"] }, deps),
    registerClientCore({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" }, deps),
    registerClientCore({ redirect_uris: [CALLBACK], grant_types: ["implicit"] }, deps),
    registerClientCore({ redirect_uris: [CALLBACK], scope: "partner:write" }, deps),
    registerClientCore("nope", deps),
  ]);
  check(L("G. DCR rejects: foreign redirect, confidential auth, other grants, other scope, non-object"), bad.map((b) => [b.status, body(b).error]), [[400, "invalid_redirect_uri"], [400, "invalid_client_metadata"], [400, "invalid_client_metadata"], [400, "invalid_client_metadata"], [400, "invalid_client_metadata"]]);
  const other = body(await registerClientCore({ redirect_uris: [CALLBACK] }, deps)).client_id as string;
  await registerClientCore({ redirect_uris: [CALLBACK] }, deps);
  const capped = await registerClientCore({ redirect_uris: [CALLBACK] }, deps);
  check(L("G. DCR: hard cap on active clients"), [capped.status, body(capped).error], [400, "invalid_client_metadata"]);
  await hooks.ageUnusedClients();
  check(L("G. registrations the Owner never authorized age out of the cap (an unauthenticated flood cannot lock the Owner out)"), (await registerClientCore({ redirect_uris: [CALLBACK] }, deps)).status, 201);

  // ── authorization request validation ──
  const q = (o: Record<string, string> = {}) => ({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", scope: "partner:read", resource: deps.config.resource, state: "st-1", ...o });
  const v = await Promise.all([
    validateAuthorizeRequest(q({ client_id: "rbmcp_" + "x".repeat(32) }), deps),
    validateAuthorizeRequest(q({ redirect_uri: "https://claude.ai/api/mcp/auth_callback/../evil" }), deps),
    validateAuthorizeRequest(q({ code_challenge: "" }), deps),
    validateAuthorizeRequest(q({ code_challenge_method: "plain" }), deps),
    validateAuthorizeRequest(q({ scope: "partner:read partner:write" }), deps),
    validateAuthorizeRequest(q({ resource: "https://partner-staging.example.com/api/other" }), deps),
    validateAuthorizeRequest({ ...q(), state: ["a", "b"] }, deps),
  ]);
  check(L("F/W. authorize: unknown client / unregistered redirect → error page, never a redirect (no open redirect)"), [v[0].ok || v[0].kind, v[1].ok || v[1].kind], ["NO_REDIRECT", "NO_REDIRECT"]);
  const loc = (x: typeof v[number]) => (!x.ok && x.kind === "REDIRECT" ? new URL(x.location).searchParams.get("error") : null);
  check(L("W. authorize: missing PKCE / plain PKCE / wrong scope / wrong resource → error back to the verified redirect"), [loc(v[2]), loc(v[3]), loc(v[4]), loc(v[5])], ["invalid_request", "invalid_request", "invalid_scope", "invalid_target"]);
  check(L("W. repeated parameter is invalid"), v[6].ok, false);
  const good = await validateAuthorizeRequest(q(), deps);
  if (!good.ok) throw new Error("authorize validation failed");
  const r = good.request;

  // ── consent (CSRF bound to Owner + exact request) ──
  const csrf = consentToken(r, OWNER_BINDING, deps);
  const d1 = await decideAuthorization(r, { binding: { userId: "11111111-0000-4000-8000-000000000000", sessionId: OWNER_SESSION }, approve: true, csrf }, deps);
  const d2 = await decideAuthorization({ ...r, state: "tampered" }, { binding: OWNER_BINDING, approve: true, csrf }, deps);
  nowSec.v += deps.config.consentTtlSeconds + 5;
  const d3 = await decideAuthorization(r, { binding: OWNER_BINDING, approve: true, csrf }, deps);
  nowSec.v -= deps.config.consentTtlSeconds + 5;
  check(L("W. consent CSRF: another user / a changed request / an expired form are refused"), [d1.ok, d2.ok, d3.ok], [false, false, false]);
  const deny = await decideAuthorization(r, { binding: OWNER_BINDING, approve: false, csrf }, deps);
  check(L("F. Owner declines → access_denied back to Claude (with state + iss)"), deny.ok ? [new URL(deny.location).searchParams.get("error"), new URL(deny.location).searchParams.get("state"), new URL(deny.location).searchParams.get("iss")] : null, ["access_denied", "st-1", deps.config.issuer]);

  const approve = async () => {
    const d = await decideAuthorization(r, { binding: OWNER_BINDING, approve: true, csrf: consentToken(r, OWNER_BINDING, deps) }, deps);
    if (!d.ok) throw new Error(d.error);
    const u = new URL(d.location);
    return { code: u.searchParams.get("code")!, state: u.searchParams.get("state"), iss: u.searchParams.get("iss"), host: u.host };
  };
  const a1 = await approve();
  check(L("F. Owner approves → code to Claude's exact callback (state + iss)"), [a1.host, a1.state, a1.iss, a1.code.startsWith("rbmcp_ac_")], ["claude.ai", "st-1", deps.config.issuer, true]);

  // ── token exchange threats ──
  const exch = (o: Record<string, string>) => tokenCore(form({ grant_type: "authorization_code", client_id: clientId, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: deps.config.resource, ...o }), deps);
  const wrongPkce = await exch({ code: a1.code, code_verifier: "w".repeat(43) });
  const afterWrong = await exch({ code: a1.code });
  check(L("W. wrong PKCE verifier → invalid_grant, and the code is burned (no second try)"), [wrongPkce.status, body(wrongPkce).error, body(afterWrong).error], [400, "invalid_grant", "invalid_grant"]);
  const a2 = await approve();
  check(L("W. missing PKCE verifier → invalid_grant"), body(await exch({ code: a2.code, code_verifier: "" })).error, "invalid_grant");
  const a3 = await approve();
  check(L("W. wrong redirect URI at the token endpoint → invalid_grant"), body(await exch({ code: a3.code, redirect_uri: "https://claude.ai/other" })).error, "invalid_grant");
  const a4 = await approve();
  check(L("W. code presented by another client → invalid_grant"), body(await exch({ code: a4.code, client_id: other })).error, "invalid_grant");
  const a5 = await approve();
  check(L("K/W. wrong resource (audience) at the token endpoint → invalid_target"), body(await exch({ code: a5.code, resource: "https://partner-staging.example.com/api/x" })).error, "invalid_target");
  const a6 = await approve();
  await hooks.expireCodes();
  check(L("W. expired code → invalid_grant"), body(await exch({ code: a6.code })).error, "invalid_grant");
  check(L("W. client_secret on a public client → invalid_client"), body(await exch({ code: "x", client_secret: "s" })).error, "invalid_client");

  const a7 = await approve();
  const t1 = await exch({ code: a7.code });
  const tok = body(t1);
  check(L("H. valid exchange → Bearer access (≤1h) + refresh, scope partner:read, no-store"), [t1.status, tok.token_type, tok.expires_in <= 3600 && tok.expires_in > 3500, tok.access_token.startsWith("rbmcp_at_"), tok.refresh_token.startsWith("rbmcp_rt_"), tok.scope, t1.headers["Cache-Control"]], [200, "Bearer", true, true, true, "partner:read", "no-store"]);
  const auth = (h: string | null, c = deps) => authenticateBearer(h, c);
  check(L("H. the access token authenticates as the Owner"), await auth(`Bearer ${tok.access_token}`).then((x) => x.ok && x.principal.userId), OWNER);
  const replay = await exch({ code: a7.code });
  check(L("W. authorization-code replay → invalid_grant AND the tokens issued from it are revoked"), [body(replay).error, (await auth(`Bearer ${tok.access_token}`)).ok], ["invalid_grant", false]);

  // ── bearer threats ──
  const a8 = await approve();
  const live = body(await exch({ code: a8.code }));
  const b = await Promise.all([auth(null), auth("Bearer"), auth("Basic abc"), auth(`Bearer ${"rbmcp_at_" + "z".repeat(43)}`), auth(`bearer ${live.access_token}`), auth(`Bearer ${live.refresh_token}`)]);
  check(L("W. missing / malformed / unknown / wrong-case / refresh-as-access bearer → 401"), b.map((x) => (x.ok ? "OK" : `${x.status}:${x.category}`)),
    ["401:MISSING_TOKEN", "401:MALFORMED_TOKEN", "401:MALFORMED_TOKEN", "401:UNKNOWN_TOKEN", "401:MALFORMED_TOKEN", "401:MALFORMED_TOKEN"]);
  const miss = b[0];
  check(L("W. 401 carries the RFC 9728 challenge (resource_metadata + scope)"), !miss.ok && miss.headers["WWW-Authenticate"], `Bearer resource_metadata="${deps.config.resourceMetadataUrl}", scope="partner:read"`);
  const otherCfg = testConfig({}, { ...BASE_ENV, PARTNER_MCP_BASE_URL: "https://another-server.example.com" });
  const wa = await auth(`Bearer ${live.access_token}`, { ...deps, config: otherCfg });
  check(L("K/W. a token for this server presented to another resource → 401 (audience)"), wa.ok ? "OK" : `${wa.status}:${wa.category}`, "401:WRONG_AUDIENCE");

  // ── refresh rotation ──
  const refresh = (rt: string, o: Record<string, string> = {}) => tokenCore(form({ grant_type: "refresh_token", client_id: clientId, refresh_token: rt, resource: deps.config.resource, ...o }), deps);
  const r1 = body(await refresh(live.refresh_token));
  check(L("I. refresh → a new access + a NEW refresh token"), [!!r1.access_token, !!r1.refresh_token, r1.refresh_token !== live.refresh_token], [true, true, true]);
  check(L("I. the new access token works"), (await auth(`Bearer ${r1.access_token}`)).ok, true);
  const r2 = body(await refresh(r1.refresh_token));
  check(L("I. the rotated refresh token works once more"), !!r2.access_token, true);
  const oldReplay = await refresh(live.refresh_token);
  check(L("I/W. an OLD (already used) refresh token → invalid_grant AND the whole family is revoked"), [body(oldReplay).error, (await auth(`Bearer ${r2.access_token}`)).ok, body(await refresh(r2.refresh_token)).error], ["invalid_grant", false, "invalid_grant"]);
  check(L("W. refresh by another client → invalid_grant"), body(await refresh(body(await exch({ code: (await approve()).code })).refresh_token, { client_id: other })).error, "invalid_grant");

  // ── revocation ──
  const f = body(await exch({ code: (await approve()).code }));
  const rv = await revokeCore({ token: f.access_token, client_id: clientId }, deps);
  check(L("J. RFC 7009: revoking the access token revokes its family (access AND refresh), 200 either way"), [rv.status, (await auth(`Bearer ${f.access_token}`)).ok, body(await refresh(f.refresh_token)).error, (await revokeCore({ token: "unknown", client_id: clientId }, deps)).status], [200, false, "invalid_grant", 200]);
  const g = body(await exch({ code: (await approve()).code }));
  await revokeCore({ token: g.refresh_token, client_id: clientId }, deps);
  check(L("W. revoked refresh token → invalid_grant; its access token is dead too"), [body(await refresh(g.refresh_token)).error, (await auth(`Bearer ${g.access_token}`)).ok], ["invalid_grant", false]);
  const h = body(await exch({ code: (await approve()).code }));
  await hooks.expireAccess();
  check(L("W. expired access token → 401 TOKEN_EXPIRED"), await auth(`Bearer ${h.access_token}`).then((x) => (x.ok ? "OK" : x.category)), "TOKEN_EXPIRED");
  await hooks.expireRefresh();
  check(L("W. expired refresh token → invalid_grant"), body(await refresh(h.refresh_token)).error, "invalid_grant");

  // ── concurrency ──
  const cc = await approve();
  const [x1, x2] = await Promise.all([exch({ code: cc.code }), exch({ code: cc.code })]);
  const issued = [x1, x2].filter((x) => x.status === 200).map(body);
  check(L("V. two parallel exchanges of one code → at most one issues, and no usable token survives the replay"), [issued.length <= 1, [x1, x2].filter((x) => x.status === 400).length >= 1, issued.length ? (await auth(`Bearer ${issued[0].access_token}`)).ok : false], [true, true, false]);
  const pr = body(await exch({ code: (await approve()).code }));
  const [y1, y2] = await Promise.all([refresh(pr.refresh_token), refresh(pr.refresh_token)]);
  const yIssued = [y1, y2].filter((x) => x.status === 200).map(body);
  check(L("V. two parallel refreshes of one token → at most one issues; the replay revokes the family (nothing usable)"), [yIssued.length <= 1, yIssued.length ? (await auth(`Bearer ${yIssued[0].access_token}`)).ok : false, (await auth(`Bearer ${pr.access_token}`)).ok], [true, false, false]);

  // ── kill switch (revoke-all) + disabled client ──
  const k = body(await exch({ code: (await approve()).code }));
  const nRevoked = await hooks.revokeAll();
  check(L("L. revoke-all kills every connector token (Owner sessions untouched: separate system)"), [nRevoked > 0, (await auth(`Bearer ${k.access_token}`)).ok, body(await refresh(k.refresh_token)).error, await hooks.activeTokens()], [true, false, "invalid_grant", 0]);
  const k2 = body(await exch({ code: (await approve()).code }));
  await hooks.disableClient(clientId);
  check(L("a disabled client: tokens stop working, new authorizations refused"), [await auth(`Bearer ${k2.access_token}`).then((x) => (x.ok ? "OK" : x.category)), (await validateAuthorizeRequest(q(), deps)).ok], ["TOKEN_CLIENT_DISABLED", false]);
}
