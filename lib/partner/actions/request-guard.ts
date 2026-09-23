/**
 * Redbloods Partner — same-origin guard for the Owner decision POST routes
 * (Phase F.1J). Pure.
 *
 * The app has no shared CSRF helper; these routes add defence in depth on top
 * of the SameSite session cookie and requireOwner():
 *   - Content-Type must be application/json (a cross-site form post cannot send it
 *     without a CORS preflight, which these routes never grant);
 *   - Origin must be present and match the request host (Host or X-Forwarded-Host);
 *   - Sec-Fetch-Site, when the browser sends it, must be same-origin;
 *   - the body is size-limited.
 */
export const MAX_DECISION_BODY_BYTES = 4096;

export function checkSameOriginJson(headers: Headers): string | null {
  const ct = (headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) return "content-type must be application/json";
  const origin = headers.get("origin");
  if (!origin) return "missing Origin";
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return "malformed Origin"; }
  const hosts = [headers.get("host"), headers.get("x-forwarded-host")]
    .flatMap((h) => (h ?? "").split(",")).map((h) => h.trim()).filter(Boolean);
  if (!hosts.includes(originHost)) return "cross-origin request";
  const sfs = headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin") return "cross-site fetch";
  return null;
}

/** Reads a small JSON body; null on oversize / invalid JSON. */
export async function readSmallJson(req: Request): Promise<unknown | null> {
  const text = await req.text();
  if (text.length > MAX_DECISION_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}
