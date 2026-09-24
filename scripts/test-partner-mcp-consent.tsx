/**
 * Tests — Redbloods Partner MCP connector: the Owner CONSENT decision (CSRF / WebView contract).
 *
 * Run with:   npx tsx scripts/test-partner-mcp-consent.tsx
 *
 * Integration lesson under test: OAuth consent must support real Claude mobile WebView behavior; browser fetch
 * metadata alone is not sufficient proof of consent authenticity. Header fixtures reproduce REAL observations:
 *   - IOS_OBSERVED — the failing real Claude iOS consent POST of 2026-09-24 (iPhone WebKit UA, same host, the page
 *     served with Referrer-Policy: no-referrer ⇒ Origin: null, no Referer, Sec-Fetch-Site: same-origin — reproduced
 *     header-for-header in a real browser engine against a local echo server);
 *   - IOS_FIXED — the same flow with the consent page's policy now same-origin (Origin = our origin);
 *   - OLD_WEBVIEW — no Origin / no fetch metadata at all.
 * Pure: the real consentDecisionCore + OAuth core over the in-memory store mirror; no network.
 */
import fs from "node:fs";
import path from "node:path";
import { MemoryConsentReplayGuard } from "../lib/integrations/partner-mcp/consent";
import { pkceS256 } from "../lib/integrations/partner-mcp/crypto";
import { consentDecisionCore, consentToken, registerClientCore, tokenCore, validateAuthorizeRequest, type ConsentSession, type HttpOut, type OAuthDeps } from "../lib/integrations/partner-mcp/oauth";
import { safeInternalRedirect } from "../lib/safe-redirect";
import { memoryMcpStore } from "./fixtures/mcp-memory-store";
import { CALLBACK, OWNER, OWNER_SESSION, testConfig, VERIFIER } from "./fixtures/mcp-oauth-scenarios";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => check(name, cond, true);

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const clock = { sec: Math.floor(Date.now() / 1000) };
  const store = memoryMcpStore(() => clock.sec * 1000);
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  const deps: OAuthDeps & { log(e: string, d: Record<string, unknown>): void } = {
    config: testConfig(), store, nowSec: () => clock.sec, consentReplay: new MemoryConsentReplayGuard(), log: (event, data) => logs.push({ event, data }),
  };
  const BASE = deps.config.baseUrl;
  const PAGE = `${BASE}/mcp-oauth/authorize?client_id=x`;
  const H = {
    DESKTOP_SAME: { origin: BASE, referer: PAGE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": DESKTOP_UA },
    IOS_OBSERVED: { origin: "null", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": IPHONE_UA },
    IOS_FIXED: { origin: BASE, referer: PAGE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": IPHONE_UA },
    OLD_WEBVIEW: { "user-agent": IPHONE_UA },
    EVIL: { origin: "https://evil.example", referer: "https://evil.example/x", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": DESKTOP_UA },
    EVIL_NULL_ORIGIN: { origin: "null", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": DESKTOP_UA },
    EVIL_FOREIGN_REFERER_ONLY: { referer: "https://evil.example/page", "user-agent": DESKTOP_UA },
    EVIL_SAME_SITE: { origin: "https://evil.partner-staging.example.com", "sec-fetch-site": "same-site", "user-agent": DESKTOP_UA },
    CLAUDE_ORIGIN: { origin: "https://claude.ai", "sec-fetch-site": "cross-site", "user-agent": IPHONE_UA },
  } as const;
  const OWNER_S: ConsentSession = { userId: OWNER, sessionId: OWNER_SESSION, isOwner: true };

  const clientId = JSON.parse((await registerClientCore({ client_name: "Claude", redirect_uris: [CALLBACK] }, deps)).body!).client_id as string;
  const params = (o: Record<string, string> = {}) => ({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", scope: "partner:read", resource: deps.config.resource, state: "claude-state-123", ...o });
  /** What the consent page renders for this session (hidden fields + the single-use token). */
  const renderPage = async (session: ConsentSession = OWNER_S, o: Record<string, string> = {}) => {
    const v = await validateAuthorizeRequest(params(o), deps);
    if (!v.ok) throw new Error("render");
    return { ...params(o), csrf: consentToken(v.request, { userId: session.userId, sessionId: session.sessionId }, deps) };
  };
  const post = (headers: Record<string, string>, form: Record<string, string> | null, session: ConsentSession | null = OWNER_S): Promise<HttpOut> =>
    consentDecisionCore({ header: (n) => (headers as Record<string, string>)[n.toLowerCase()] ?? null, form, session }, deps);
  const codes = () => store.hooks.counts().codes;
  const redirectOf = (o: HttpOut) => (o.status === 303 ? new URL(o.headers.Location) : null);

  console.log("Real-world browsers / WebViews with a genuine Owner consent → approved");
  for (const [name, h] of [["normal same-origin desktop browser", H.DESKTOP_SAME], ["Claude iOS — OBSERVED failing request (Origin: null, no Referer, Sec-Fetch-Site same-origin)", H.IOS_OBSERVED], ["Claude iOS — after the referrer-policy fix (Origin = our origin)", H.IOS_FIXED], ["old WebView without Origin / fetch metadata", H.OLD_WEBVIEW]] as const) {
    const before = codes();
    const out = await post(h, { ...(await renderPage()), decision: "allow" });
    const u = redirectOf(out);
    check(`7. ${name} → 303 to Claude's exact callback with code + state + iss, exactly one code`, [out.status, u?.origin + (u?.pathname ?? ""), u?.searchParams.get("state"), u?.searchParams.get("iss"), !!u?.searchParams.get("code"), codes() - before], [303, CALLBACK, "claude-state-123", deps.config.issuer, true, 1]);
  }
  const iosOut = await post(H.IOS_OBSERVED, { ...(await renderPage()), decision: "allow" });
  const code = redirectOf(iosOut)!.searchParams.get("code")!;
  const tok = JSON.parse((await tokenCore({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: deps.config.resource }, deps)).body!);
  check("9. the iOS-approved code is PKCE S256-bound, exchanges once, and only the code travels in the URL", [tok.token_type, !!tok.access_token, JSON.parse((await tokenCore({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: VERIFIER }, deps)).body!).error, [...redirectOf(iosOut)!.searchParams.keys()].sort()], ["Bearer", true, "invalid_grant", ["code", "iss", "state"]]);
  const deny = await post(H.IOS_OBSERVED, { ...(await renderPage()), decision: "deny" });
  check("7. Claude iOS — Owner declines → access_denied back to Claude, no code", [redirectOf(deny)?.searchParams.get("error"), redirectOf(deny)?.searchParams.has("code")], ["access_denied", false]);

  console.log("Malicious cross-site POSTs → refused (even with an otherwise valid-looking form)");
  for (const [name, h] of [["foreign Origin (evil.example)", H.EVIL], ["Origin: null + Sec-Fetch-Site cross-site (attacker page with no-referrer)", H.EVIL_NULL_ORIGIN], ["foreign Referer only", H.EVIL_FOREIGN_REFERER_ONLY], ["same-site sibling origin", H.EVIL_SAME_SITE], ["Origin claude.ai (the client is NOT trusted to vouch for consent)", H.CLAUDE_ORIGIN]] as const) {
    const before = codes();
    const out = await post(h, { ...(await renderPage()), decision: "allow" });
    check(`J. ${name} → 403, no code`, [out.status, out.body, codes() - before], [403, "cross-site consent refused", 0]);
  }
  const noCookie = await post(H.OLD_WEBVIEW, { ...(await renderPage()), decision: "allow" }, null);
  check("J. a cross-site POST that slips past metadata still has NO Owner session (SameSite=Lax cookie not sent) → 403", [noCookie.status, codes()], [403, codes()]);

  console.log("CSRF token binding / replay / expiry / tampering (with an authenticated Owner)");
  const n0 = codes();
  const form = { ...(await renderPage()), decision: "allow" };
  check("K. missing consent token → refused", (await post(H.IOS_OBSERVED, { ...form, csrf: "" })).status, 400);
  check("K. forged consent token → refused", (await post(H.IOS_OBSERVED, { ...form, csrf: `c2.${"A".repeat(22)}.${clock.sec + 100}.${"0".repeat(64)}` })).status, 400);
  const other: ConsentSession = { userId: OWNER, sessionId: "5e55e55e-0000-4000-8000-0000000000bb", isOwner: true };
  check("K. token from ANOTHER Owner session (same user, other session id) → refused", (await post(H.IOS_OBSERVED, { ...(await renderPage(other)), decision: "allow" })).status, 400);
  check("K. token from another user → refused", (await post(H.IOS_OBSERVED, { ...(await renderPage({ userId: "11111111-0000-4000-8000-000000000000", sessionId: OWNER_SESSION, isOwner: true })), decision: "allow" })).status, 400);
  for (const [field, val] of [["state", "tampered"], ["code_challenge", pkceS256("x".repeat(50))]] as const) {
    check(`K. modified authorization request (${field}) with the original token → refused`, (await post(H.IOS_OBSERVED, { ...form, [field]: val })).status, 400);
  }
  const otherClient = JSON.parse((await registerClientCore({ redirect_uris: [CALLBACK] }, deps)).body!).client_id as string;
  check("K. token for another client → refused", (await post(H.IOS_OBSERVED, { ...form, client_id: otherClient })).status, 400);
  check("K. token for another redirect URI (unapproved) → error page, never a redirect", [(await post(H.IOS_OBSERVED, { ...form, redirect_uri: "https://evil.example/cb" })).status], [400]);
  const badScope = await post(H.IOS_OBSERVED, { ...form, scope: "partner:read partner:write" });
  check("K. token for another scope → error back to the verified callback (invalid_scope), no code", [redirectOf(badScope)?.searchParams.get("error"), redirectOf(badScope)?.searchParams.has("code")], ["invalid_scope", false]);
  const badRes = await post(H.IOS_OBSERVED, { ...form, resource: "https://other.example/api/mcp" });
  check("K. token for another resource → invalid_target, no code", [redirectOf(badRes)?.searchParams.get("error"), redirectOf(badRes)?.searchParams.has("code")], ["invalid_target", false]);
  check("K. none of the tampered / foreign submissions created a code", codes(), n0);
  const once = await post(H.IOS_OBSERVED, form);
  const again = await post(H.IOS_OBSERVED, form);
  check("K. replayed consent submission → the first succeeds, the replay is refused (single use)", [once.status, again.status, again.body?.includes("already submitted"), codes() - n0], [303, 400, true, 1]);
  const denyForm = { ...(await renderPage()), decision: "deny" };
  await post(H.IOS_OBSERVED, denyForm);
  check("K. a token used to DENY cannot then be used to allow", (await post(H.IOS_OBSERVED, { ...denyForm, decision: "allow" })).status, 400);
  const late = { ...(await renderPage()), decision: "allow" };
  clock.sec += 301;
  check("K. expired consent token (> 5 min) → refused", (await post(H.IOS_OBSERVED, late)).status, 400);
  clock.sec -= 301;

  console.log("Session / method / form");
  check("5. no session → 403", (await post(H.IOS_OBSERVED, { ...(await renderPage()), decision: "allow" }, null)).status, 403);
  check("5. authenticated NON-Owner → 403", (await post(H.IOS_OBSERVED, { ...(await renderPage()), decision: "allow" }, { ...OWNER_S, isOwner: false })).status, 403);
  check("unreadable form / missing decision → 400", [(await post(H.IOS_OBSERVED, null)).status, (await post(H.IOS_OBSERVED, { ...(await renderPage()) })).status], [400, 400]);
  ok("5. GET cannot approve: the decision route exports POST only", !/export (async function|const) GET/.test(rd("app/api/mcp-oauth/authorize/route.ts")));

  console.log("Safe logging + contract");
  const refused = logs.filter((l) => l.event === "partner_mcp_consent_refused");
  ok("every refusal is logged with request CLASSES only (reason, origin class, sec-fetch-*, UA class)", refused.length > 0 && refused.every((l) => typeof l.data.reason === "string" && ["same", "null", "absent", "foreign"].includes(String(l.data.origin))));
  const blob = JSON.stringify(logs);
  ok("logs never contain the consent token, code, state, client id, cookies or the raw User-Agent / Origin values", !/c2\.|rbmcp_|claude-state|evil\.example|Mozilla|cookie/i.test(blob));
  ok("the real iOS rejection classes are recorded as ios-webkit / null origin / same-origin", logs.some((l) => l.data.ua === "ios-webkit" && l.data.origin === "null" && l.data.secFetchSite === "same-origin"));
  const nextCfg = rd("next.config.ts");
  ok("ROOT CAUSE fixed: the consent page is served with Referrer-Policy same-origin, never no-referrer", /source: "\/mcp-oauth\/:path\*"[\s\S]*?"Referrer-Policy", value: "same-origin"/.test(nextCfg) && !/"Referrer-Policy", value: "no-referrer"/.test(nextCfg));
  ok("the consent page issues the token bound to the verified session (getConsentSession)", /getConsentSession\(\)/.test(rd("app/mcp-oauth/authorize/page.tsx")) && /consentToken\(r, \{ userId: session\.userId, sessionId: session\.sessionId \}/.test(rd("app/mcp-oauth/authorize/page.tsx")));
  ok("the integration lesson is part of the consent contract", /OAuth consent must support real Claude\s*\n?\s*\*?\s*mobile WebView behavior; browser fetch metadata alone is not sufficient proof of consent authenticity/.test(rd("lib/integrations/partner-mcp/consent.ts")));

  console.log("Safe redirect (no regression)");
  const consentPath = `/mcp-oauth/authorize?${new URLSearchParams(params()).toString()}`;
  const login = new URL("/login", BASE); login.searchParams.set("redirect", consentPath);
  check("login → consent redirect stays internal and exact", safeInternalRedirect(new URLSearchParams(login.search).get("redirect")), consentPath);
  check("open-redirect attacks still fall back to /", ["//evil.example", "/\\evil.example", "/%2F%2Fevil.example", "/%5Cevil.example", "/%zz"].map(safeInternalRedirect), ["/", "/", "/", "/", "/"]);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
