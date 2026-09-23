import { NextResponse, type NextRequest } from "next/server";
import { changeSuggestedActionValue } from "@/lib/partner/actions/action-service";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";

/**
 * POST /api/partner/actions/change-deadline — "שנה תאריך" (Phase F.1J).
 *
 *   body: { actionId, seenSnapshotHash, answerCode: IN_ONE_WEEK | IN_TWO_WEEKS | END_OF_MONTH | SPECIFIC_DATE,
 *           explicitDateYmd: YYYY-MM-DD for SPECIFIC_DATE, else null }
 *
 * NOT an Action Event: an append-only Owner Context revision of the existing
 * WHAT_IS_NEW_PROJECT_DEADLINE answer (changeSuggestedActionValue → appendOwnerContext).
 * Same-origin JSON only, Owner-only. Never updates the project, never executes.
 */
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["actionId", "seenSnapshotHash", "answerCode", "explicitDateYmd"];
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const guard = checkSameOriginJson(req.headers);
  if (guard) return json({ status: "FORBIDDEN_ORIGIN" }, 403);
  const body = await readSmallJson(req);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ status: "INVALID_INPUT" }, 400);
  const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknownKeys.length) return json({ status: "INVALID_INPUT", errors: unknownKeys.map((k) => `"${k}" cannot be supplied`) }, 400);
  try {
    const r = await changeSuggestedActionValue(body);
    switch (r.status) {
      case "UNAUTHORIZED": return json({ status: r.status }, 401);
      case "FORBIDDEN": return json({ status: r.status }, 403);
      case "INVALID_INPUT": return json({ status: r.status, errors: r.errors }, 400);
      case "LIVE_READ_FAILED": return json({ status: r.status }, 503);
      case "INVARIANT_VIOLATION": case "FAILED": console.error("[partner/actions/change-deadline]", r.status, r.detail); return json({ status: r.status }, 500);
      case "CONTEXT_REVISED": return json({ status: r.status, newDeadline: r.newDeadline });
      case "NOT_DERIVABLE": case "STALE": case "PROPOSAL_CHANGED": return json({ status: r.status });
      default: return json({ status: "FAILED" }, 500);
    }
  } catch (err) {
    console.error("[partner/actions/change-deadline] failed:", err instanceof Error ? err.message : err);
    return json({ status: "FAILED" }, 500);
  }
}
