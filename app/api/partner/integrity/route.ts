import { NextResponse } from "next/server";
import { getIntegritySurface } from "@/lib/partner/integrity/server";

/**
 * GET /api/partner/integrity → IntegritySurfaceDto (v1)
 *
 * Redbloods Partner — Company Integrity "צריך ממך": OWNER-ONLY, READ-ONLY. At most 2 questions (the ones the live
 * register surfaces right now) + what Partner has learned from earlier answers. Display text only; failures are
 * generic (no internals). No write of any kind.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const r = await getIntegritySurface();
    if (r.status === "UNAUTHORIZED") return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    if (r.status === "FORBIDDEN") return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    if (r.status !== "OK") {
      console.warn("[partner/integrity] unavailable:", r.detail);
      return NextResponse.json({ error: "partner_integrity_unavailable" }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json(r.surface, { headers: NO_STORE });
  } catch (err) {
    console.error("[partner/integrity] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "partner_integrity_failed" }, { status: 500, headers: NO_STORE });
  }
}
