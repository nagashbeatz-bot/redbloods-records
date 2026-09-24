/**
 * Tests — the canonical post-login redirect validator (lib/safe-redirect.ts) and its use by /login.
 *
 * Run with:   npx tsx scripts/test-safe-redirect.ts
 *
 * Pure: no network, no browser. Every accepted value is additionally resolved the way a browser would
 * (new URL(value, origin)) and must stay on the Redbloods origin.
 */
import fs from "node:fs";
import path from "node:path";
import { SAFE_REDIRECT_FALLBACK, safeInternalRedirect } from "../lib/safe-redirect";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => check(name, cond, true);
const F = SAFE_REDIRECT_FALLBACK;
const SITE = "https://redbloods-records-production.up.railway.app";
const staysOnSite = (v: string) => new URL(v, SITE).origin === SITE;

console.log("Allowed internal paths");
check("1. \"/\" allowed", safeInternalRedirect("/"), "/");
check("2. \"/projects\" allowed", safeInternalRedirect("/projects"), "/projects");
check("deep link with query + hash kept (push deep links)", safeInternalRedirect("/team/victor?tab=schedule#top"), "/team/victor?tab=schedule#top");
const consent = "/mcp-oauth/authorize?response_type=code&client_id=rbmcp_abcdefghijklmnopqrstuvwxyz012345&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&scope=partner%3Aread&resource=https%3A%2F%2Fpartner-staging.example.com%2Fapi%2Fmcp&state=abc-123";
check("3. \"/mcp-oauth/authorize?…query…\" allowed unchanged (the encoded https:// INSIDE the query is fine)", safeInternalRedirect(consent), consent);

console.log("Blocked → fallback \"/\"");
const attacks: Array<[string, string]> = [
  ["4. https://evil.com", "https://evil.com"],
  ["5. http://evil.com", "http://evil.com"],
  ["6. //evil.com", "//evil.com"],
  ["7. \\\\evil.com", "\\\\evil.com"],
  ["8. /\\evil.com (browsers read \\ as /)", "/\\evil.com"],
  ["8b. \\/evil.com", "\\/evil.com"],
  ["9. encoded //  (/%2F%2Fevil.com)", "/%2F%2Fevil.com"],
  ["9b. encoded // lower-case (/%2f%2fevil.com)", "/%2f%2fevil.com"],
  ["9c. %2F%2Fevil.com (no leading slash)", "%2F%2Fevil.com"],
  ["9d. double-encoded (/%252F%252Fevil.com)", "/%252F%252Fevil.com"],
  ["9e. /%2F/evil.com", "/%2F/evil.com"],
  ["10. encoded backslash (/%5Cevil.com)", "/%5Cevil.com"],
  ["10b. encoded backslash lower-case (/%5cevil.com)", "/%5cevil.com"],
  ["10c. double-encoded backslash (/%255Cevil.com)", "/%255Cevil.com"],
  ["10d. mixed slash (/\\/evil.com)", "/\\/evil.com"],
  ["11. javascript:", "javascript:alert(1)"],
  ["11b. JavaScript: mixed case", "JaVaScRiPt:alert(1)"],
  ["12. data:", "data:text/html,<script>alert(1)</script>"],
  ["13. malformed percent encoding (/%E0%A4%A)", "/%E0%A4%A"],
  ["13b. malformed percent encoding (/%zz)", "/%zz"],
  ["control: tab after slash (/\\t/evil.com)", "/\t/evil.com"],
  ["control: newline (/\\n/evil.com)", "/\n/evil.com"],
  ["control: encoded tab (/%09/evil.com)", "/%09/evil.com"],
  ["control: NUL (/%00)", "/%00"],
  ["leading space ( /evil)", " //evil.com"],
  ["unicode line separator", "/" + String.fromCharCode(0x2028) + "/evil.com"],
  ["userinfo trick (//user@evil.com)", "//user@evil.com"],
  ["/login (no bounce back)", "/login"],
  ["/login?redirect=//evil.com (no loop)", "/login?redirect=//evil.com"],
  ["/maintenance", "/maintenance"],
  ["overlong value", "/" + "a".repeat(3000)],
];
for (const [name, v] of attacks) check(`${name} → "/"`, safeInternalRedirect(v), F);
check("14. empty redirect → \"/\"", safeInternalRedirect(""), F);
check("15. missing redirect (null / undefined) → \"/\"", [safeInternalRedirect(null), safeInternalRedirect(undefined)], [F, F]);

console.log("Browser-equivalence: every accepted value stays on the Redbloods origin");
const accepted = ["/", "/projects", consent, "/team/victor?tab=schedule#top", "/a/b/../c", "/%E2%9C%93"].map(safeInternalRedirect);
ok("all accepted results resolve on-site", accepted.every(staysOnSite));
ok("the fallback itself is on-site", staysOnSite(F));
ok("no attack value ever yields anything but the fallback", attacks.every(([, v]) => safeInternalRedirect(v) === F));

console.log("16. OAuth consent return path (proxy → /login?redirect=… → back to consent)");
{
  // exactly what proxy.ts toLogin() builds for an unauthenticated Owner hitting the consent page
  const original = new URL(`${SITE}${consent}`);
  const login = new URL("/login", SITE);
  login.searchParams.set("redirect", original.pathname + original.search);
  // exactly what the login page reads (useSearchParams → URLSearchParams.get)
  const param = new URLSearchParams(login.search).get("redirect");
  const target = safeInternalRedirect(param);
  check("16. the Owner lands back on the SAME consent URL after login", target, original.pathname + original.search);
  const back = new URL(target, SITE);
  check("16. every OAuth parameter survives the round trip", ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "resource", "state"].map((k) => back.searchParams.get(k) === original.searchParams.get(k)), Array(7).fill(true));
}

console.log("Wiring: /login uses the validator and nothing else");
{
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "app/login/page.tsx"), "utf8");
  ok("the login page validates the redirect through safeInternalRedirect()", /const redirectTo = safeInternalRedirect\(params\.get\("redirect"\)\);/.test(src) && /window\.location\.assign\(redirectTo\)/.test(src));
  ok("the old startsWith(\"/\") check is gone", !/redirectTo\.startsWith\("\/"\)/.test(src));
  const lib = fs.readFileSync(path.join(ROOT, "lib/safe-redirect.ts"), "utf8");
  ok("the validator has no dependencies (no URL-sanitizer library)", !/^import /m.test(lib));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
