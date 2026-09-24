/**
 * Redbloods Partner MCP connector — OAuth 2.1 authorization server core (single Owner). Pure logic over an
 * injected store; no Next / Supabase imports.
 *
 *   Registration (RFC 7591 DCR) — public clients only (token_endpoint_auth_method "none"), redirect URIs must
 *     be EXACTLY in the configured allowlist (Claude's callback), grant types ⊆ {authorization_code, refresh_token},
 *     hard cap on active clients. Not a general OAuth platform.
 *   Authorization — code flow + PKCE S256 (required), exact redirect URI, resource (RFC 8707) bound to THIS MCP
 *     server, scope partner:read only, Owner consent proven by a single-use, session-bound consent token (consent.ts).
 *   Token — code exchange and refresh rotation are single atomic DB calls; errors are the RFC error codes.
 *   Bearer — opaque access token → hash → one DB check; audience (resource) and scope enforced here.
 */
import { canonicalUrl, MCP_SCOPE, type McpConfig } from "./config";
import { newClientId, PKCE_CHALLENGE, PKCE_VERIFIER, pkceS256, randomSecret, sha256Hex, TOKEN_PREFIX } from "./crypto";
import { classifyConsentRequest, crossSiteSignal, issueConsentToken, verifyConsentToken, type ConsentBinding, type ConsentReplayGuard } from "./consent";
import type { McpStore } from "./store";

export interface OAuthDeps { config: McpConfig; store: McpStore; nowSec(): number; consentReplay: ConsentReplayGuard }
export interface HttpOut { status: number; headers: Record<string, string>; body: string | null }

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}): HttpOut => ({ status, headers: { "Content-Type": "application/json", ...NO_STORE, ...extra }, body: JSON.stringify(body) });
const oauthError = (status: number, error: string, description: string) => json(status, { error, error_description: description });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ── registration ─────────────────────────────────────────────────────────────

export async function registerClientCore(body: unknown, deps: OAuthDeps): Promise<HttpOut> {
  if (!isObj(body)) return oauthError(400, "invalid_client_metadata", "body must be a JSON object");
  const redirects = body.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 4 || !redirects.every((r) => typeof r === "string" && deps.config.allowedRedirectUris.includes(r))) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must be exactly the allowed connector callback(s)");
  }
  const auth = body.token_endpoint_auth_method ?? "none";
  if (auth !== "none") return oauthError(400, "invalid_client_metadata", "only public clients (token_endpoint_auth_method none, PKCE) are supported");
  const grants = body.grant_types ?? ["authorization_code", "refresh_token"];
  if (!Array.isArray(grants) || !grants.length || !grants.every((g) => g === "authorization_code" || g === "refresh_token") || !grants.includes("authorization_code")) {
    return oauthError(400, "invalid_client_metadata", "grant_types must be authorization_code (+ refresh_token)");
  }
  const rt = body.response_types ?? ["code"];
  if (!Array.isArray(rt) || rt.length !== 1 || rt[0] !== "code") return oauthError(400, "invalid_client_metadata", "response_types must be [\"code\"]");
  if (body.scope !== undefined && (typeof body.scope !== "string" || !body.scope.split(" ").every((s) => s === MCP_SCOPE || s === "offline_access" || s === ""))) {
    return oauthError(400, "invalid_client_metadata", "only scope partner:read is available");
  }
  const name = typeof body.client_name === "string" ? body.client_name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100) : "";
  const clientId = newClientId();
  const grantTypes = [...new Set(grants as string[])];
  const r = await deps.store.registerClient({ clientId, clientName: name, redirectUris: [...new Set(redirects as string[])], grantTypes, maxActive: deps.config.maxActiveClients });
  if (r === "LIMIT_REACHED") return oauthError(400, "invalid_client_metadata", "connector client limit reached — revoke old clients first");
  return json(201, {
    client_id: clientId, client_id_issued_at: deps.nowSec(), client_name: name, redirect_uris: [...new Set(redirects as string[])],
    grant_types: grantTypes, response_types: ["code"], token_endpoint_auth_method: "none", scope: MCP_SCOPE,
  });
}

// ── authorization (consent) ──────────────────────────────────────────────────

export interface AuthorizeRequest { clientId: string; clientName: string; redirectUri: string; codeChallenge: string; scope: string; resource: string; state: string }
export type AuthorizeValidation =
  | { ok: true; request: AuthorizeRequest }
  /** Client / redirect cannot be trusted → show an error page, NEVER redirect (no open redirect). */
  | { ok: false; kind: "NO_REDIRECT"; error: string }
  /** Redirect URI is verified → the error goes back to the client. */
  | { ok: false; kind: "REDIRECT"; location: string };

const one = (p: Record<string, string | string[] | undefined>, k: string): string | null => {
  const v = p[k];
  if (Array.isArray(v)) return null; // repeated parameter → invalid
  return typeof v === "string" ? v : null;
};

export function errorRedirect(redirectUri: string, error: string, state: string | null, issuer: string, description?: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", issuer);
  return u.toString();
}

export async function validateAuthorizeRequest(params: Record<string, string | string[] | undefined>, deps: OAuthDeps): Promise<AuthorizeValidation> {
  if (Object.values(params).some(Array.isArray)) return { ok: false, kind: "NO_REDIRECT", error: "repeated parameter" };
  const clientId = one(params, "client_id"), redirectUri = one(params, "redirect_uri");
  if (!clientId || !redirectUri) return { ok: false, kind: "NO_REDIRECT", error: "missing client_id or redirect_uri" };
  const client = await deps.store.getClient(clientId);
  if (!client || client.disabled) return { ok: false, kind: "NO_REDIRECT", error: "unknown client" };
  if (!client.redirectUris.includes(redirectUri) || !deps.config.allowedRedirectUris.includes(redirectUri)) return { ok: false, kind: "NO_REDIRECT", error: "redirect_uri is not registered for this client" };
  const state = one(params, "state") ?? "";
  if (state.length > 500) return { ok: false, kind: "NO_REDIRECT", error: "state too long" };
  const back = (error: string, d: string): AuthorizeValidation => ({ ok: false, kind: "REDIRECT", location: errorRedirect(redirectUri, error, state || null, deps.config.issuer, d) });
  if (one(params, "response_type") !== "code") return back("unsupported_response_type", "response_type must be code");
  const challenge = one(params, "code_challenge"), method = one(params, "code_challenge_method");
  if (!challenge || !PKCE_CHALLENGE.test(challenge) || method !== "S256") return back("invalid_request", "PKCE S256 is required");
  const scopeRaw = one(params, "scope") ?? MCP_SCOPE;
  const scopes = scopeRaw.split(" ").filter(Boolean);
  if (!scopes.every((s) => s === MCP_SCOPE || s === "offline_access")) return back("invalid_scope", "only partner:read is available");
  const res = one(params, "resource");
  if (res !== null && canonicalUrl(res) !== deps.config.resource) return back("invalid_target", "resource must be this Redbloods Partner MCP server");
  return { ok: true, request: { clientId, clientName: client.clientName, redirectUri, codeChallenge: challenge, scope: MCP_SCOPE, resource: deps.config.resource, state } };
}

const consentFields = (r: AuthorizeRequest) => [r.clientId, r.redirectUri, r.codeChallenge, r.scope, r.resource, r.state];

/** A single-use consent token bound to the Owner's user id + session id and to this exact authorization request. */
export function consentToken(r: AuthorizeRequest, binding: ConsentBinding, deps: OAuthDeps): string {
  return issueConsentToken(deps.config.secret, binding, consentFields(r), deps.nowSec());
}

/**
 * The Owner's decision (the caller has already authenticated the Owner and re-validated the request).
 * The consent token must verify (binding + request + expiry) and is consumed exactly once — allow OR deny.
 */
export async function decideAuthorization(r: AuthorizeRequest, i: { binding: ConsentBinding; approve: boolean; csrf: string }, deps: OAuthDeps): Promise<{ ok: true; location: string } | { ok: false; error: string; reason: string }> {
  const now = deps.nowSec();
  const v = verifyConsentToken(deps.config.secret, i.binding, consentFields(r), i.csrf, now);
  if (!v.ok) return { ok: false, reason: `CONSENT_${v.reason}`, error: "consent form expired or invalid — start again from Claude" };
  if (!deps.consentReplay.consume(v.jti, v.exp, now)) return { ok: false, reason: "CONSENT_REPLAY", error: "this consent was already submitted — start again from Claude" };
  if (!i.approve) return { ok: true, location: errorRedirect(r.redirectUri, "access_denied", r.state || null, deps.config.issuer, "the Owner declined") };
  const code = randomSecret(TOKEN_PREFIX.code);
  const created = await deps.store.createCode({ codeHash: sha256Hex(code), clientId: r.clientId, userId: i.binding.userId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, scope: r.scope, resource: r.resource, ttlSeconds: deps.config.codeTtlSeconds });
  if (created !== "CREATED") return { ok: false, reason: `CODE_${created}`, error: `authorization could not be created (${created})` };
  const u = new URL(r.redirectUri);
  u.searchParams.set("code", code);
  if (r.state) u.searchParams.set("state", r.state);
  u.searchParams.set("iss", deps.config.issuer);
  return { ok: true, location: u.toString() };
}

export interface ConsentSession { userId: string; sessionId: string; isOwner: boolean }

/**
 * The consent decision POST, end to end (the route is a thin shell around this).
 *   1. deny-only browser signals (foreign Origin / Referer, Sec-Fetch-Site cross-site/same-site) — an absent or
 *      "null" Origin is NOT decisive (real WebView / no-referrer behaviour);
 *   2. an authenticated Owner session (user id + session id);
 *   3. the authorization request re-validated from scratch (hidden fields are never trusted);
 *   4. the single-use consent token bound to that session and that exact request.
 * Every refusal is logged with SAFE request classes only (never cookies, codes, tokens or the form).
 */
export async function consentDecisionCore(
  req: { header(name: string): string | null; form: Record<string, string> | null; session: ConsentSession | null },
  deps: OAuthDeps & { log(event: string, data: Record<string, unknown>): void },
): Promise<HttpOut> {
  const H = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const plain = (status: number, text: string): HttpOut => ({ status, headers: { "Content-Type": "text/plain; charset=utf-8", ...H }, body: text });
  const to = (location: string): HttpOut => ({ status: 303, headers: { Location: location, ...H }, body: null });
  const cls = classifyConsentRequest(req.header, deps.config.baseUrl);
  const refuse = (reason: string, out: HttpOut) => { deps.log("partner_mcp_consent_refused", { reason, ...cls }); return out; };
  const signal = crossSiteSignal(cls);
  if (signal) return refuse(signal, plain(403, "cross-site consent refused"));
  if (!req.session) return refuse("NO_SESSION", plain(403, "sign in as the Redbloods Owner first — start again from Claude"));
  if (!req.session.isOwner) return refuse("NOT_OWNER", plain(403, "only the Redbloods Owner can authorize the connector"));
  if (!req.form) return refuse("BAD_FORM", plain(400, "invalid form"));
  const decision = req.form.decision;
  if (decision !== "allow" && decision !== "deny") return refuse("BAD_DECISION", plain(400, "invalid decision"));
  const v = await validateAuthorizeRequest(req.form, deps);
  if (!v.ok) return v.kind === "REDIRECT" ? to(v.location) : refuse("INVALID_REQUEST", plain(400, v.error));
  const d = await decideAuthorization(v.request, { binding: { userId: req.session.userId, sessionId: req.session.sessionId }, approve: decision === "allow", csrf: req.form.csrf ?? "" }, deps);
  if (!d.ok) return refuse(d.reason, plain(400, d.error));
  deps.log("partner_mcp_consent_decided", { decision, ...cls });
  return to(d.location);
}

// ── token endpoint ───────────────────────────────────────────────────────────

const GRANT_ERRORS: Record<string, [number, string]> = { INVALID_GRANT: [400, "invalid_grant"], INVALID_TARGET: [400, "invalid_target"], INVALID_TTL: [500, "server_error"] };

export async function tokenCore(form: Record<string, string>, deps: OAuthDeps): Promise<HttpOut> {
  const { config, store } = deps;
  if (form.client_secret !== undefined) return oauthError(401, "invalid_client", "public client — no client secret");
  const clientId = form.client_id;
  if (!clientId) return oauthError(401, "invalid_client", "client_id is required");
  const client = await store.getClient(clientId);
  if (!client || client.disabled) return oauthError(401, "invalid_client", "unknown client");
  const resource = form.resource === undefined ? null : canonicalUrl(form.resource);
  if (form.resource !== undefined && resource !== config.resource) return oauthError(400, "invalid_target", "resource must be this Redbloods Partner MCP server");
  if (form.scope !== undefined && !form.scope.split(" ").filter(Boolean).every((s) => s === MCP_SCOPE || s === "offline_access")) return oauthError(400, "invalid_scope", "only partner:read is available");

  const access = randomSecret(TOKEN_PREFIX.access), refresh = randomSecret(TOKEN_PREFIX.refresh);
  let r;
  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.redirect_uri) return oauthError(400, "invalid_request", "code and redirect_uri are required");
    if (!form.code_verifier || !PKCE_VERIFIER.test(form.code_verifier)) return oauthError(400, "invalid_grant", "a valid PKCE code_verifier is required");
    r = await store.exchangeCode({
      codeHash: sha256Hex(form.code), clientId, redirectUri: form.redirect_uri, challengeFromVerifier: pkceS256(form.code_verifier), resource,
      accessHash: sha256Hex(access), refreshHash: sha256Hex(refresh), accessTtl: config.accessTtlSeconds, refreshTtl: config.refreshTtlSeconds, familyTtl: config.familyTtlSeconds,
    });
  } else if (form.grant_type === "refresh_token") {
    if (!client.grantTypes.includes("refresh_token")) return oauthError(400, "unauthorized_client", "refresh_token grant not registered");
    if (!form.refresh_token) return oauthError(400, "invalid_request", "refresh_token is required");
    r = await store.rotateRefresh({
      refreshHash: sha256Hex(form.refresh_token), clientId, resource,
      newAccessHash: sha256Hex(access), newRefreshHash: sha256Hex(refresh), accessTtl: config.accessTtlSeconds, refreshTtl: config.refreshTtlSeconds,
    });
  } else return oauthError(400, "unsupported_grant_type", "authorization_code or refresh_token");

  if (r.result !== "ISSUED") {
    const [status, error] = GRANT_ERRORS[r.result] ?? [400, "invalid_grant"];
    return oauthError(status, error, r.result === "INVALID_TTL" ? "server configuration error" : "the grant is invalid, expired, revoked or was already used");
  }
  const expiresIn = Math.max(1, Math.min(config.accessTtlSeconds, Math.floor((Date.parse(r.accessExpiresAt) - deps.nowSec() * 1000) / 1000)) || config.accessTtlSeconds);
  return json(200, { access_token: access, token_type: "Bearer", expires_in: expiresIn, refresh_token: refresh, scope: r.scope });
}

// ── revocation (RFC 7009) ────────────────────────────────────────────────────

export async function revokeCore(form: Record<string, string>, deps: OAuthDeps): Promise<HttpOut> {
  if (!form.client_id) return oauthError(401, "invalid_client", "client_id is required");
  if (!form.token) return oauthError(400, "invalid_request", "token is required");
  await deps.store.revokeToken(sha256Hex(form.token), form.client_id);
  return { status: 200, headers: { ...NO_STORE }, body: null }; // same answer whether or not the token existed
}

// ── bearer authentication for the MCP resource ───────────────────────────────

export interface Principal { tokenId: string; clientId: string; userId: string; scope: string }
export type BearerResult = { ok: true; principal: Principal } | { ok: false; status: 401 | 403; category: string; headers: Record<string, string>; body: string };

export async function authenticateBearer(authorization: string | null, deps: OAuthDeps): Promise<BearerResult> {
  const { config } = deps;
  const challenge = (error: string | null, extra = "") => `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="${MCP_SCOPE}"${error ? `, error="${error}"` : ""}${extra}`;
  const deny = (status: 401 | 403, category: string, error: string | null): BearerResult => ({
    ok: false, status, category, headers: { "WWW-Authenticate": challenge(error), "Content-Type": "application/json", ...NO_STORE },
    body: JSON.stringify({ error: error ?? "unauthorized" }),
  });
  if (!authorization) return deny(401, "MISSING_TOKEN", null);
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(authorization);
  if (!m || !m[1].startsWith(TOKEN_PREFIX.access)) return deny(401, "MALFORMED_TOKEN", "invalid_token");
  const r = await deps.store.checkAccess(sha256Hex(m[1]));
  if (r.result === "NOT_FOUND") return deny(401, "UNKNOWN_TOKEN", "invalid_token");
  if (r.result !== "VALID") return deny(401, `TOKEN_${r.result}`, "invalid_token");
  if (canonicalUrl(r.resource) !== config.resource) return deny(401, "WRONG_AUDIENCE", "invalid_token");
  if (!r.scope.split(" ").includes(MCP_SCOPE)) return deny(403, "INSUFFICIENT_SCOPE", "insufficient_scope");
  return { ok: true, principal: { tokenId: r.tokenId, clientId: r.clientId, userId: r.userId, scope: r.scope } };
}
