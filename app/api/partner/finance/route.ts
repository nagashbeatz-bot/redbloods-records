import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getFinanceBrief } from "@/lib/partner/finance/server";

/**
 * GET /api/partner/finance → FinanceBriefDto (v1)
 *
 * Redbloods Partner, Finance Brain V1: OWNER-ONLY, READ-ONLY financial brief.
 *   - requireOwner() here (defence in depth on top of proxy.ts default-deny; not in any role allowlist);
 *   - GET only: no transaction write, no finance setting write, no Action Event, no Owner Context,
 *     no Feedback, no baseline write, no RPC, no Push / Cron / Agent Alerts;
 *   - display data only (no ids / raw evidence); failures are generic (no internals).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const r = await getFinanceBrief();
    if (r.status !== "OK") {
      console.warn("[partner/finance] unavailable:", r.detail);
      return NextResponse.json({ error: "partner_finance_unavailable" }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json(r.brief, { headers: NO_STORE });
  } catch (err) {
    console.error("[partner/finance] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "partner_finance_failed" }, { status: 500, headers: NO_STORE });
  }
}
