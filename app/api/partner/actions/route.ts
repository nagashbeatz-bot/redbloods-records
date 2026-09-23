import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getOwnerActionSurface } from "@/lib/partner/actions/surface-server";

/**
 * GET /api/partner/actions → { v: 1, items: PartnerActionCardDto[] }
 *
 * Redbloods Partner, Phase F.1I: OWNER-ONLY, READ-ONLY surface of the
 * Suggested Actions whose surfacing state is SHOW.
 *   - requireOwner() here (defence in depth on top of proxy.ts default-deny;
 *     not in any role allowlist / PUBLIC_BYPASS);
 *   - GET only: no decision, no Action Event, no Owner Context write, no RPC,
 *     no project mutation, no Feedback, no baseline write;
 *   - the response carries display data only (no snapshot / hash / event ids).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const r = await getOwnerActionSurface();
    if (r.status !== "OK") return NextResponse.json({ error: "partner_actions_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(r.response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[partner/actions] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "partner_actions_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
