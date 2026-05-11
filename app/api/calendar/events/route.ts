import { NextResponse } from "next/server";

/**
 * GET /api/calendar/events
 * Returns { today, week } — arrays of ParsedCalendarEvent.
 * Projects are fetched from Monday to enable project-matching.
 */
export async function GET() {
  try {
    const { isConnected, fetchTodayAndWeek } = await import("@/lib/google-calendar");

    if (!isConnected()) {
      return NextResponse.json(
        { error: "not_connected", today: [], week: [] },
        { status: 200 } // 200 so the widget can show "not connected" gracefully
      );
    }

    // Fetch Monday projects for matching (best-effort — if it fails, we proceed without matching)
    let projects: Array<{ id: string; name: string; artist: string }> = [];
    try {
      const { fetchProjects } = await import("@/lib/monday");
      projects = (await fetchProjects()).map((p) => ({
        id:     p.id,
        name:   p.name,
        artist: p.artist,
      }));
    } catch {
      // Non-fatal — proceed without project matching
    }

    const { today, week } = await fetchTodayAndWeek(projects);

    return NextResponse.json({ today, week });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[calendar/events]", msg);
    return NextResponse.json({ error: msg, today: [], week: [] }, { status: 500 });
  }
}
