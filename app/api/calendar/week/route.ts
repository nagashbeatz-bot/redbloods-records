import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/calendar/week?weekStart=YYYY-MM-DD
 * Returns all calendar events for the 7-day period starting on weekStart.
 */
export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart) {
    return NextResponse.json({ error: "weekStart חסר" }, { status: 400 });
  }

  try {
    const { isConnected, fetchEventsInRange } = await import("@/lib/google-calendar");
    if (!isConnected()) {
      return NextResponse.json({ error: "not_connected", events: [] });
    }

    const start = new Date(weekStart + "T00:00:00");
    const end   = new Date(start.getTime() + 7 * 86_400_000);

    // Project stubs for matching — best-effort (calendar still works without them)
    let projects: { id: string; name: string; artist: string }[] = [];
    try {
      const { fetchProjects } = await import("@/lib/monday");
      const raw = await fetchProjects();
      projects = raw.map((p) => ({ id: p.id, name: p.name, artist: p.artist }));
    } catch { /* ignore — show events without project links */ }

    const events = await fetchEventsInRange(start, end, projects);
    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    const needsReauth =
      msg.includes("insufficient") || msg.includes("forbidden") ||
      msg.includes("401")          || msg.includes("403");
    return NextResponse.json(
      { error: msg, events: [], needsReauth },
      { status: needsReauth ? 403 : 500 }
    );
  }
}
