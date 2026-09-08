import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getShow } from "@/lib/shows-store";
import { notifyDjAboutShow } from "@/lib/dj-show-notify";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/shows/[id]/notify-dj
 *
 * Owner-only. Fired ONLY by the "שלח" button next to an upcoming show in
 * DJ CLEANTONE's portal management — never automatically (not on show
 * create/update, not on page load/refresh). Takes ONLY the show id from the
 * URL; the server always re-reads the show fresh and builds the push content
 * itself — the client can never choose a recipient, a body, or a URL. The
 * mirror of /api/shows/[id]/notify-artist (Shalev), scoped to
 * shows.dj_client_id === CLEANTONE_CLIENT_ID.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const show = await getShow(id);
    if (!show) return NextResponse.json({ ok: false, error: "הופעה לא נמצאה" }, { status: 404 });

    const result = await notifyDjAboutShow(show);
    if (result.ok) {
      return NextResponse.json({ ok: true, djSent: result.djSent, ownerSent: result.ownerSent });
    }

    const MSG: Record<typeof result.reason, string> = {
      not_dj:          "ההופעה אינה משויכת ל-DJ CLEANTONE",
      not_upcoming:     "ניתן לשלוח רק על הופעה עתידית",
      already_sent:     "כבר נשלחה התראה לגרסה הזו של ההופעה",
      in_progress:      "שליחה כבר מתבצעת — נסה שוב עוד רגע",
      no_subscription:  "ל-DJ CLEANTONE אין מכשיר עם התראות פעילות",
      send_failed:      "השליחה נכשלה — נסה שוב",
    };
    return NextResponse.json({ ok: false, error: MSG[result.reason], reason: result.reason }, { status: result.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[shows notify-dj] error:", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
