import { NextRequest, NextResponse } from "next/server";
import { clampRangeDays } from "@/lib/release-calendar";

/**
 * GET /api/calendar/week?weekStart=YYYY-MM-DD[&days=N]
 * Returns all calendar events for the period starting on weekStart — 7 days by default.
 * The optional `days` (1..45) lets the "הוסף ריליס" date step read a month grid from the
 * same read-only path; without it the response is exactly what it always was.
 */
export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart) {
    return NextResponse.json({ error: "weekStart חסר" }, { status: 400 });
  }
  const days = clampRangeDays(req.nextUrl.searchParams.get("days"));

  try {
    const { isConnected, fetchEventsInRange } = await import("@/lib/google-calendar");
    if (!await isConnected()) {
      return NextResponse.json({ error: "not_connected", events: [] });
    }

    const start = new Date(weekStart + "T00:00:00");
    const end   = new Date(start.getTime() + days * 86_400_000);

    // Project stubs for matching — best-effort (calendar still works without them)
    let projects: { id: string; name: string; artist: string }[] = [];
    try {
      const { listProjects } = await import("@/lib/projects-store");
      projects = (await listProjects()).map((p) => ({ id: p.id, name: p.name, artist: p.artist }));
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
