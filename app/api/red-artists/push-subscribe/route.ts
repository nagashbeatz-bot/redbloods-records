import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess, getAuthRole, getAuthUser } from "@/lib/require-auth";
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
  // Bind the device to the authenticated user — never proceed unidentified.
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let hasEndpoint = false;
  try {
    const sub = await req.json();
    hasEndpoint = !!sub?.endpoint;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      console.warn(`[red-artists/push-subscribe] role=${audience} endpoint=${hasEndpoint} → invalid subscription`);
      return NextResponse.json({ error: "פרטי המנוי אינם תקינים" }, { status: 400 });
    }
    await saveSubscription(sub, audience, user.id); // throws if the DB rejected the row
    console.info(`[red-artists/push-subscribe] role=${audience} endpoint=true → saved`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Log the REAL reason server-side; return a SAFE message (no DB internals).
    console.error(`[red-artists/push-subscribe] role=${audience} endpoint=${hasEndpoint} → save failed:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "שמירת המנוי נכשלה" }, { status: 500 });
  }
}
