import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/require-auth";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { saveSubscription } from "@/lib/push";

/**
 * POST /api/label/artists/[id]/push-subscribe — register a Web Push subscription
 * for a restricted portal artist reading their OWN page (today: Avi Molla), or
 * the owner previewing it. Mirrors /api/red-artists/push-subscribe (Shalev) —
 * same saveSubscription, same shape — but scoped through resolvePortalReadAccess
 * so it only ever accepts Avi on his own id (or the owner). The device is tagged
 * with the caller's ACTUAL role as the audience ("avi" | "owner") and bound to
 * their user id. This handler ONLY stores the subscription; it never sends a
 * push. NO schema change — push_subscriptions.role already accepts any string.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;

  const audience = access.role; // "avi" | "owner"
  // Bind the device to the authenticated user — never proceed unidentified.
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let hasEndpoint = false;
  try {
    const sub = await req.json();
    hasEndpoint = !!sub?.endpoint;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      console.warn(`[label/artists push-subscribe] role=${audience} endpoint=${hasEndpoint} → invalid subscription`);
      return NextResponse.json({ error: "פרטי המנוי אינם תקינים" }, { status: 400 });
    }
    await saveSubscription(sub, audience, user.id); // throws if the DB rejected the row
    console.info(`[label/artists push-subscribe] role=${audience} endpoint=true → saved`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[label/artists push-subscribe] role=${audience} endpoint=${hasEndpoint} → save failed:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "שמירת המנוי נכשלה" }, { status: 500 });
  }
}
