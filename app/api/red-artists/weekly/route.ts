import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { SHALEV_NAME } from "@/lib/red-artists/portal-registry";
import { resolvePortalConfigByName } from "@/lib/red-artists/portal-config";
import { isValidYmd, weekStartFor, weekEndFor, currentWeekStart } from "@/lib/red-artists/week";
import { fetchArtistWeeklyEvents } from "@/lib/red-artists/weekly-events";

/**
 * GET /api/red-artists/weekly?start=YYYY-MM-DD  (owner or shalev, READ-ONLY)
 *
 * Shalev's own real schedule for an ARBITRARY Sun–Sat week — the navigable
 * "היומן השבועי שלי" calendar. Separate from shalev-summary's `weekly`
 * (always the fixed upcoming availability week, unchanged) — this route
 * exists so the calendar can page forward/back without touching that
 * endpoint's existing behavior. `start` is snapped to its own week's Sunday
 * server-side (defensive — the client always sends an aligned Sunday
 * already); missing/invalid → the current Israel week.
 */
export async function GET(req: NextRequest) {
  const denied = await requireShalevAccess();
  if (denied) return denied;

  try {
    const raw = req.nextUrl.searchParams.get("start");
    const weekStart = weekStartFor(raw && isValidYmd(raw) ? raw : currentWeekStart());
    const weekEnd = weekEndFor(weekStart);
    const config = await resolvePortalConfigByName(SHALEV_NAME);
    const items = await fetchArtistWeeklyEvents(SHALEV_NAME, weekStart, weekEnd, config?.artistId ?? null);
    return NextResponse.json({ ok: true, weekStart, weekEnd, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
