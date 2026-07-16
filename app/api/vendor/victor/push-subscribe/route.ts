import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { saveSubscription } from "@/lib/push";

/**
 * POST /api/vendor/victor/push-subscribe — Victor registers his device for Web
 * Push. Lives under /api/vendor/victor/* (already inside Victor's proxy
 * allowlist) and is gated by requireVictorAccess. Saves with role="victor" so
 * these devices receive ONLY Victor-facing notices and NEVER the owner-internal
 * ones (sendPushToAll → role "owner").
 *
 * requireVictorAccess also admits the OWNER, so the concrete role is re-checked:
 * an owner session reaching this endpoint (e.g. while viewing Victor's page) is
 * rejected, so an owner device can never be mislabelled "victor" and start
 * receiving Victor's pushes. Owner subscribes via /api/push/subscribe ("owner").
 *
 * Mirrors app/api/supplier/steven/push-subscribe/route.ts.
 */
export async function POST(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied; // 401/403 for non owner/victor
  // Only a real Victor session may create a "victor" device.
  if ((await getAuthRole()) !== "victor") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    const sub = await req.json();
    await saveSubscription(sub, "victor");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("victor push subscribe error:", e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
