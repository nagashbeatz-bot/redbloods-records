import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { queryPartnerKnowledge } from "@/lib/partner/gateway/server";

/**
 * GET /api/partner/knowledge?capability=<id>[&mode=<mode>][&limit=<n>][&cursor=<c>][&p.<param>=<value>…]
 *
 * Redbloods OS → the Unified Partner Knowledge Gateway (the SAME queryPartnerKnowledge the Claude connector uses),
 * with the INTERNAL audience. OWNER-ONLY (requireOwner, on top of proxy.ts default-deny), READ-ONLY (GET only; the
 * registry holds read capabilities only). Parameters are the capability's typed params — never SQL / tables / filters.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const AUDIENCE = { channel: "INTERNAL", ownerAuthorized: true } as const;

export async function GET(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of sp) if (k.startsWith("p.") && k.length <= 32) params[k.slice(2)] = v.slice(0, 120);
  const limitRaw = sp.get("limit");
  try {
    const r = await queryPartnerKnowledge({
      capability: (sp.get("capability") ?? "").slice(0, 40),
      ...(sp.get("mode") ? { mode: sp.get("mode")!.slice(0, 30) } : {}),
      ...(Object.keys(params).length ? { params } : {}),
      ...(limitRaw !== null ? { limit: Number(limitRaw) } : {}),
      ...(sp.get("cursor") ? { cursor: sp.get("cursor")!.slice(0, 300) } : {}),
    }, AUDIENCE);
    return NextResponse.json(r, { status: r.status === "OK" ? 200 : r.status === "UNKNOWN_CAPABILITY" ? 404 : 400, headers: NO_STORE });
  } catch (err) {
    console.error("[partner/knowledge] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "partner_knowledge_failed" }, { status: 500, headers: NO_STORE });
  }
}
