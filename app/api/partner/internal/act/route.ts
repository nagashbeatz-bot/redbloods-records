import { NextRequest, NextResponse } from "next/server";
import { handleInternalAct } from "@/lib/partner/act/internal-handler";

/**
 * POST /api/partner/internal/act — Sunny connector → Redbloods MAIN: the Universal Action Layer (plan / preview /
 * approve / execute / status) for the Owner, through the ONE registry + engine. Service-to-service authenticated
 * (dedicated secret header, constant-time); OFF unless PARTNER_ACT_ENABLED=true; 404 on the MCP-only connector.
 * Every write still needs the Boss's explicit approval of the exact previewed plan.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const r = await handleInternalAct(
    { header: (n) => req.headers.get(n), bodyText: () => req.text() },
    process.env,
    async () => (await import("@/lib/partner/act/server")).realActDeps(process.env),
  );
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
}
