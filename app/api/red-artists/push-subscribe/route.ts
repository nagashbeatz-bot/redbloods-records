import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess, getAuthRole } from "@/lib/require-auth";
import { saveSubscription } from "@/lib/push";

/**
 * POST /api/red-artists/push-subscribe — register a Web Push subscription for a
 * portal user (owner or shalev), tagged with the ACTUAL server-side role so the
 * availability push reaches the right device. Mirrors /api/push/subscribe (owner)
 * and the Steven subscribe route; does NOT touch Victor/Steven subscriptions.
 */
export async function POST(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  const audience = (await getAuthRole()) === "shalev" ? "shalev" : "owner";
  try {
    const sub = await req.json();
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
    }
    await saveSubscription(sub, audience);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "server error" }, { status: 500 });
  }
}
