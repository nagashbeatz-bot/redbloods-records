import { NextResponse, type NextRequest } from "next/server";
import { decideSuggestedAction } from "@/lib/partner/actions/action-service";
import { ilWallClockToInstant } from "@/lib/partner/actions/defer";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";

/**
 * POST /api/partner/actions/decide — Owner decision on a Suggested Action (Phase F.1J).
 *
 *   body: { actionId, decision: "APPROVE" | "NOT_NOW", seenSnapshotHash, expectedHeadEventId, requestId,
 *           deferChoice?: LATER_TODAY | TOMORROW | IN_3_DAYS | IN_1_WEEK | CUSTOM, deferDateYmd?: YYYY-MM-DD (CUSTOM only) }
 *
 * - same-origin JSON only (request-guard.ts); Owner-only (decideSuggestedAction → requireOwner, actor from the session);
 * - calls ONLY decideSuggestedAction(): it persists an APPROVED / NOT_NOW event after live re-derivation.
 *   APPROVE never executes — there is no execution call here (execution is F.1K);
 * - REJECT / CHANGE_VALUE are not accepted on this route (CHANGE_VALUE has its own Owner Context route);
 * - the client can never supply actor, snapshot, from / to, event type or a resolved defer instant
 *   (CUSTOM sends a calendar date; the server resolves 09:00 Israel time).
 */
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["actionId", "decision", "seenSnapshotHash", "expectedHeadEventId", "requestId", "deferChoice", "deferDateYmd"];
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const guard = checkSameOriginJson(req.headers);
  if (guard) return json({ status: "FORBIDDEN_ORIGIN" }, 403);
  const body = await readSmallJson(req);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ status: "INVALID_INPUT" }, 400);
  const b = body as Record<string, unknown>;
  const unknownKeys = Object.keys(b).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknownKeys.length) return json({ status: "INVALID_INPUT", errors: unknownKeys.map((k) => `"${k}" cannot be supplied`) }, 400);
  if (b.decision !== "APPROVE" && b.decision !== "NOT_NOW") return json({ status: "INVALID_INPUT", errors: ["decision must be APPROVE or NOT_NOW"] }, 400);

  const input: Record<string, unknown> = {
    actionId: b.actionId, decision: b.decision, seenSnapshotHash: b.seenSnapshotHash,
    expectedHeadEventId: b.expectedHeadEventId ?? null, requestId: b.requestId,
  };
  if (b.decision === "NOT_NOW") {
    if (b.deferChoice !== undefined) input.deferChoice = b.deferChoice;
    if (b.deferChoice === "CUSTOM") {
      if (typeof b.deferDateYmd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.deferDateYmd)) return json({ status: "INVALID_INPUT", errors: ["CUSTOM requires deferDateYmd"] }, 400);
      input.deferUntil = ilWallClockToInstant(b.deferDateYmd, 9).toISOString();
    } else if (b.deferDateYmd !== undefined) return json({ status: "INVALID_INPUT", errors: ["deferDateYmd only with CUSTOM"] }, 400);
  } else if (b.deferChoice !== undefined || b.deferDateYmd !== undefined) return json({ status: "INVALID_INPUT", errors: ["defer fields only with NOT_NOW"] }, 400);

  try {
    const r = await decideSuggestedAction(input);
    switch (r.status) {
      case "UNAUTHORIZED": return json({ status: r.status }, 401);
      case "FORBIDDEN": return json({ status: r.status }, 403);
      case "INVALID_INPUT": return json({ status: r.status, errors: r.errors }, 400);
      case "RETRYABLE": return json({ status: r.status }, 503);
      case "INVARIANT_VIOLATION": case "FAILED": console.error("[partner/actions/decide]", r.status, r.detail); return json({ status: r.status }, 500);
      case "LIVE_READ_FAILED": return json({ status: r.status }, 503);
      case "RECORDED": case "REPLAY": return json({ status: r.status, eventType: r.event.eventType, eventId: r.event.id, deferUntil: r.event.deferUntil });
      case "ALREADY_IN_STATE": case "ALREADY_EXECUTED": return json({ status: r.status, headEventType: r.head.eventType });
      case "HEAD_CONFLICT": return json({ status: r.status });
      case "PROPOSAL_CHANGED": case "STALE": case "NOT_DERIVABLE": case "REQUEST_ID_CONFLICT": case "INVALID_TRANSITION": case "USE_OWNER_CONTEXT_FLOW": return json({ status: r.status });
      default: return json({ status: "FAILED" }, 500);
    }
  } catch (err) {
    console.error("[partner/actions/decide] failed:", err instanceof Error ? err.message : err);
    return json({ status: "FAILED" }, 500);
  }
}
