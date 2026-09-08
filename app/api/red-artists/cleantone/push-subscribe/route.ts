import { NextRequest, NextResponse } from "next/server";
import { requireCleantoneAccess, getAuthRole, getAuthUser } from "@/lib/require-auth";
import { saveSubscription } from "@/lib/push";

/**
 * POST /api/red-artists/cleantone/push-subscribe — register a Web Push
 * subscription for DJ CLEANTONE (or the owner previewing his portal). A 1:1
 * mirror of /api/red-artists/push-subscribe (Shalev) and
 * /api/label/artists/[id]/push-subscribe (Avi): same saveSubscription, same
 * body shape, guarded by the existing requireCleantoneAccess. The device is
 * tagged with the caller's ACTUAL role as the audience ("cleantone" | "owner")
 * and bound to their user id.
 *
 * This handler ONLY stores the subscription — it never sends a push (send stays
 * server-side; nothing here touches cron / agent / notify). NO schema change:
 * push_subscriptions.role already accepts any string. NO proxy allowlist change:
 * the "/api/red-artists/cleantone" prefix in isCleantoneAllowedPath already
 * covers this path (same as .../cleantone/shows/[id]/confirm).
 */
export async function POST(req: NextRequest) {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;

  const audience = (await getAuthRole()) === "cleantone" ? "cleantone" : "owner";
  // Bind the device to the authenticated user — never proceed unidentified.
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let hasEndpoint = false;
  try {
    const sub = await req.json();
    hasEndpoint = !!sub?.endpoint;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      console.warn(`[cleantone/push-subscribe] role=${audience} endpoint=${hasEndpoint} → invalid subscription`);
      return NextResponse.json({ error: "פרטי המנוי אינם תקינים" }, { status: 400 });
    }
    await saveSubscription(sub, audience, user.id); // throws if the DB rejected the row
    console.info(`[cleantone/push-subscribe] role=${audience} endpoint=true → saved`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[cleantone/push-subscribe] role=${audience} endpoint=${hasEndpoint} → save failed:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "שמירת המנוי נכשלה" }, { status: 500 });
  }
}
