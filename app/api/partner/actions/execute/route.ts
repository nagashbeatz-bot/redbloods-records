import { NextResponse, type NextRequest } from "next/server";
import { executeApprovedAction } from "@/lib/partner/actions/action-service";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";

/**
 * POST /api/partner/actions/execute — "בצע עכשיו" on an APPROVED Partner Action (Phase F.1K).
 *
 *   body: { approvalEventId: uuid, requestId: uuid }   (nothing else is accepted)
 *
 * - same-origin JSON only (identical guard to F.1J); strict whitelist + uuid shapes BEFORE the primitive;
 * - Owner-only: executeApprovedAction() → requireOwner(), actor from the session;
 * - calls ONLY executeApprovedAction(): live revalidation, then the approved DB RPC, which alone owns the
 *   locks, CAS, staleness, the project mutation and the EXECUTED / STALE_AT_EXECUTION audit (atomic).
 *   No project update, no snapshot / from / to / actor from the client, no automatic retry;
 * - responses are structured and minimal (no SQL / internal details).
 */
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["approvalEventId", "requestId"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const guard = checkSameOriginJson(req.headers);
  if (guard) return json({ status: "FORBIDDEN_ORIGIN" }, 403);
  const body = await readSmallJson(req);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ status: "INVALID_INPUT" }, 400);
  const b = body as Record<string, unknown>;
  const errors = Object.keys(b).filter((k) => !ALLOWED_KEYS.includes(k)).map((k) => `"${k}" cannot be supplied`);
  if (typeof b.approvalEventId !== "string" || !UUID.test(b.approvalEventId)) errors.push("approvalEventId must be a uuid");
  if (typeof b.requestId !== "string" || !UUID.test(b.requestId)) errors.push("requestId must be a uuid");
  if (errors.length) return json({ status: "INVALID_INPUT", errors }, 400);

  try {
    const r = await executeApprovedAction({ approvalEventId: b.approvalEventId, requestId: b.requestId });
    switch (r.status) {
      case "UNAUTHORIZED": return json({ status: r.status }, 401);
      case "FORBIDDEN": return json({ status: r.status }, 403);
      case "INVALID_INPUT": return json({ status: r.status }, 400);
      case "RETRYABLE": return json({ status: r.status }, 503);
      case "INVARIANT_VIOLATION": case "FAILED": console.error("[partner/actions/execute]", r.status, r.detail); return json({ status: "INVARIANT_VIOLATION" }, 500);
      case "EXECUTED": case "STALE_AT_EXECUTION": case "REPLAY": case "ALREADY_EXECUTED":
        return json({ status: r.status, eventType: r.eventType });
      case "APPROVAL_NOT_CURRENT": case "APPROVAL_NOT_FOUND": case "ACTION_MISMATCH": case "REQUEST_ID_CONFLICT":
        return json({ status: r.status });
      default: return json({ status: "INVARIANT_VIOLATION" }, 500);
    }
  } catch (err) {
    console.error("[partner/actions/execute] failed:", err instanceof Error ? err.message : err);
    return json({ status: "INVARIANT_VIOLATION" }, 500);
  }
}
