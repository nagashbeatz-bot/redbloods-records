import { NextResponse, type NextRequest } from "next/server";
import { answerFinanceQuestion } from "@/lib/partner/finance/answer-service";
import { checkSameOriginJson, readSmallJson } from "@/lib/partner/actions/request-guard";

/**
 * POST /api/partner/finance/answer — the Owner answers a "צריך ממך" finance question (F2.8–F2.10).
 *
 *   body: { questionId, answerCode, seenQuestionFingerprint, requestId,
 *           exactDateYmd: YYYY-MM-DD only for the EXACT_DATE answer (else absent / null) }
 *
 * Owner-only (requireOwner in the service), same-origin JSON only, small body, strict key whitelist.
 * The server re-derives the finance state and verifies the exact question; the ONLY write is one
 * append-only Owner Context revision. Never writes a transaction, price, due date or setting; never executes.
 */
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["questionId", "answerCode", "seenQuestionFingerprint", "requestId", "exactDateYmd"];
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
    const r = await answerFinanceQuestion(body);
    switch (r.status) {
      case "UNAUTHORIZED": return json({ status: r.status }, 401);
      case "FORBIDDEN": return json({ status: r.status }, 403);
      case "INVALID_INPUT": return json({ status: r.status, errors: r.errors }, 400);
      case "REQUEST_ID_CONFLICT": return json({ status: r.status }, 409);
      case "LIVE_READ_FAILED": console.warn("[partner/finance/answer] live read failed:", r.detail); return json({ status: r.status }, 503);
      case "INVARIANT_VIOLATION": case "FAILED": console.error("[partner/finance/answer]", r.status, r.detail); return json({ status: r.status }, 500);
      case "ANSWER_SAVED": case "REPLAY": case "STALE_QUESTION": return json({ status: r.status });
      default: return json({ status: "FAILED" }, 500);
    }
  } catch (err) {
    console.error("[partner/finance/answer] failed:", err instanceof Error ? err.message : err);
    return json({ status: "FAILED" }, 500);
  }
}
