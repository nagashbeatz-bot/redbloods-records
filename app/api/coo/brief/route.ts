import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { buildCoo } from "@/lib/coo/build";
import { COO_CONFIG } from "@/lib/coo/config";

/**
 * GET /api/coo/brief            → { brief }
 * GET /api/coo/brief?debug=1    → { brief, state, signals, cases, config }  (all cases, all facts — for calibration)
 *
 * Redbloods COO, Phase 1a: deterministic, OWNER-ONLY, READ-ONLY.
 *   - requireOwner() is enforced here (defence in depth on top of proxy.ts default-deny;
 *     this route is deliberately NOT in the proxy's PUBLIC_BYPASS list);
 *   - no DB writes, no push, no LLM, no external service, nothing cached.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const result = await buildCoo();
    const debug = req.nextUrl.searchParams.get("debug") === "1";
    const body = debug
      ? { brief: result.brief, state: result.state, signals: result.signals, cases: result.cases, config: COO_CONFIG }
      : { brief: result.brief };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[coo/brief] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "coo_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
