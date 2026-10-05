import { NextResponse } from "next/server";
import { getAuthUser, requireOwner } from "@/lib/require-auth";
import { readOwnerExecutive } from "@/lib/partner/gateway/executive-server";
import { readOwnerActionHistory } from "@/lib/partner/act/owner-history";

/**
 * GET /api/partner/executive — the Owner's executive read (Dashboard V2 as Sunny's surface, Owner decision 2026-10-05).
 * BUSINESS_MOTION + FINANCIAL_FORWARD + needs_me, the SAME capabilities the chat reads, with the SAME owner action
 * history and the SAME derivation (deriveWithActionHistory). OWNER-ONLY (requireOwner on top of proxy.ts default-deny),
 * READ-ONLY (no write, no push, no cache, no ranking of its own). A part that cannot be read keeps its status.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const AUDIENCE = { channel: "INTERNAL", ownerAuthorized: true } as const;

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const user = await getAuthUser();
    const history = await readOwnerActionHistory(user?.id ?? null, process.env, async () => (await import("@/lib/partner/act/server")).realActDeps(process.env));
    return NextResponse.json(await readOwnerExecutive(history, AUDIENCE), { headers: NO_STORE });
  } catch (err) {
    console.error("[partner/executive] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "partner_executive_failed" }, { status: 500, headers: NO_STORE });
  }
}
