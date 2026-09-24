/**
 * The ONE canonical validator for post-login redirects (`/login?redirect=`). Pure, no dependencies.
 *
 * Only a same-origin Redbloods path is ever returned; anything else falls back to "/" (which the proxy then
 * routes to the signed-in user's own home). Fails closed on:
 *   - absolute URLs (https:, http:, javascript:, data:, …) — the value must begin with exactly one "/";
 *   - protocol-relative URLs ("//host") and backslash tricks ("\\host", "/\host") — browsers treat "\" as "/";
 *   - encoded variants ("/%2F%2Fhost", "/%5Chost", double-encoded "%252F…") — decoded (up to 3 times) before deciding;
 *   - malformed percent-encoding, control characters, whitespace, overlong values;
 *   - /login and /maintenance themselves (never bounce back to them).
 * The legitimate OAuth return (e.g. "/mcp-oauth/authorize?client_id=…&redirect_uri=https%3A%2F%2Fclaude.ai%2F…")
 * is a same-origin path and passes unchanged.
 */
export const SAFE_REDIRECT_FALLBACK = "/";

const ORIGIN = "https://redbloods.invalid";
/** Space, C0 / C1 control characters, DEL and the U+2028 / U+2029 line separators (checked by code point). */
function hasControlOrSpace(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

export function safeInternalRedirect(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return SAFE_REDIRECT_FALLBACK;
  if (hasControlOrSpace(raw)) return SAFE_REDIRECT_FALLBACK;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return SAFE_REDIRECT_FALLBACK;

  // Decode (bounded) and re-check the PATH part: an encoded "//", "\" or control character must not survive.
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return SAFE_REDIRECT_FALLBACK; } // malformed encoding
    if (next === decoded) break;
    decoded = next;
  }
  const decodedPath = decoded.split(/[?#]/)[0];
  if (!decodedPath.startsWith("/") || decodedPath.startsWith("//") || decodedPath.includes("\\") || hasControlOrSpace(decodedPath)) return SAFE_REDIRECT_FALLBACK;

  // Final authority: resolve against a fixed origin — the result must stay on that origin.
  let u: URL;
  try { u = new URL(raw, ORIGIN); } catch { return SAFE_REDIRECT_FALLBACK; }
  if (u.origin !== ORIGIN || u.username || u.password) return SAFE_REDIRECT_FALLBACK;
  if (u.pathname === "/login" || u.pathname === "/maintenance") return SAFE_REDIRECT_FALLBACK;
  return u.pathname + u.search + u.hash;
}
