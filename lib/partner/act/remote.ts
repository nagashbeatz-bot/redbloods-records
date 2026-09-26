/**
 * Sunny connector → Redbloods MAIN internal action endpoint (the connector holds NO business writer).
 * POST only, exact URL (the MCP-only fetch guard allows exactly this URL, only when the act switch is on), dedicated
 * secret header, no redirects, bounded timeout, strict response shape. A failure is never reported as success:
 * a timeout on execute → OUTCOME_UNKNOWN (Sunny must read the plan status before saying anything).
 */
import { INTERNAL_AUTH_HEADER } from "@/lib/partner/calendar/internal-auth";
import { MAIN_BASE_URL_ENV } from "@/lib/partner/calendar/remote";
import { ACT_SECRET_ENV, INTERNAL_ACT_PATH, type ActOp } from "./internal-handler";

export function internalActUrl(env: Record<string, string | undefined> = process.env): string | null {
  const base = env[MAIN_BASE_URL_ENV];
  if (!base) return null;
  try { const u = new URL(base); if (u.protocol !== "https:" && u.hostname !== "localhost") return null; return `${u.origin}${INTERNAL_ACT_PATH}`; } catch { return null; }
}

export async function callInternalAct(op: ActOp, caller: { ownerId: string; clientId: string }, input: Record<string, unknown>, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch, timeoutMs = 45_000): Promise<Record<string, unknown>> {
  const url = internalActUrl(env);
  const secret = env[ACT_SECRET_ENV];
  if (!url || !secret || secret.length < 32) return { status: "UNAVAILABLE", messageHe: "הפעולות לא מחוברות כרגע" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { [INTERNAL_AUTH_HEADER]: secret, "content-type": "application/json" }, body: JSON.stringify({ op, ownerId: caller.ownerId, clientId: caller.clientId, input }), redirect: "error", cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return { status: "UNAVAILABLE", messageHe: "שירות הפעולות של Redbloods לא זמין כרגע", httpStatus: res.status };
    const body = (await res.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || typeof body.status !== "string" || !/^[A-Z_]{1,60}$/.test(body.status)) return { status: "UNAVAILABLE", messageHe: "תשובה לא צפויה משירות הפעולות" };
    return body;
  } catch {
    return op === "execute"
      ? { status: "OUTCOME_UNKNOWN", messageHe: "לא קיבלתי תשובה בזמן. ייתכן שהפעולה בוצעה — אבדוק את סטטוס התוכנית לפני שאגיד משהו." }
      : { status: "UNAVAILABLE", messageHe: "שירות הפעולות של Redbloods לא ענה" };
  } finally { clearTimeout(timer); }
}
