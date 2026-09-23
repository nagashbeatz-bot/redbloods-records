import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getRecentOutcomesSurface } from "@/lib/partner/actions/outcome-server";

/**
 * GET /api/partner/outcomes → { v: 1, items: PartnerOutcomeCardDto[] }
 *
 * Redbloods Partner, Phase F.1M: OWNER-ONLY, READ-ONLY surface of the most recent executed
 * Partner Actions (newest first, max 5) and their CURRENT derived Outcome (F.1L).
 *   - requireOwner() here (defence in depth on top of proxy.ts default-deny;
 *     not in any role allowlist / PUBLIC_BYPASS);
 *   - GET only: no decision, no execution, no Action Event, no Owner Context write, no RPC,
 *     no project mutation, no Feedback, no baseline write;
 *   - the response carries display data only (no snapshot / hash / internals).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const r = await getRecentOutcomesSurface();
    if (r.status !== "OK") return NextResponse.json({ error: "partner_outcomes_unavailable" }, { status: 503, headers: NO_STORE });
    return NextResponse.json(r.response, { headers: NO_STORE });
  } catch (err) {
    console.error("[partner/outcomes] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "partner_outcomes_failed" }, { status: 500, headers: NO_STORE });
  }
}
