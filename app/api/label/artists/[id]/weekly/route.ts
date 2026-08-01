import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { isValidYmd, weekStartFor, weekEndFor, currentWeekStart } from "@/lib/red-artists/week";
import { fetchArtistWeeklyEvents } from "@/lib/red-artists/weekly-events";

/**
 * GET /api/label/artists/[id]/weekly?start=YYYY-MM-DD  (owner-only, READ-ONLY)
 *
 * Owner-preview equivalent of /api/red-artists/weekly, generalized to ANY
 * registered portal artist (resolved via resolvePortalReadAccess — the
 * artist's own name, never a hardcoded literal, never trusted from the
 * client). This artist's real schedule for an ARBITRARY Sun–Sat week — the
 * navigable "היומן השבועי שלי" calendar, separate from this same artist's
 * /summary `weekly` (always the fixed upcoming availability week, unchanged).
 * `start` is snapped to its own week's Sunday server-side; missing/invalid →
 * the current Israel week.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;

  try {
    const raw = req.nextUrl.searchParams.get("start");
    const weekStart = weekStartFor(raw && isValidYmd(raw) ? raw : currentWeekStart());
    const weekEnd = weekEndFor(weekStart);
    const items = await fetchArtistWeeklyEvents(access.config.name, weekStart, weekEnd, access.config.artistId);
    return NextResponse.json({ ok: true, weekStart, weekEnd, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
