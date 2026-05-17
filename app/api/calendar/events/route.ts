import { NextResponse } from "next/server";

/**
 * GET /api/calendar/events
 * Returns { today, week } — arrays of ParsedCalendarEvent.
 * Projects are fetched from Supabase for event matching.
 */
export async function GET() {
  try {
    const { isConnected, fetchTodayAndWeek } = await import("@/lib/google-calendar");

    if (!await isConnected()) {
      return NextResponse.json(
        { error: "not_connected", today: [], week: [] },
        { status: 200 } // 200 so the widget can show "not connected" gracefully
      );
    }

    // Fetch projects from Supabase for event matching (best-effort)
    let projects: Array<{ id: string; name: string; artist: string }> = [];
    try {
      const { listProjects } = await import("@/lib/projects-store");
      projects = (await listProjects()).map((p) => ({
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
