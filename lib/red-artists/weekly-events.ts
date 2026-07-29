import "server-only";
import { supabase } from "@/lib/supabase";
import { listShows } from "@/lib/shows-store";

/**
 * Shared "this artist's real schedule for a given Sun–Sat week" query —
 * extracted from the near-duplicate logic that used to live inline in both
 * /api/red-artists/shalev-summary and /api/label/artists/[id]/summary
 * (always hardcoded to "the upcoming week"). Now parameterized by an
 * arbitrary [weekStart, weekEnd] range so the same logic serves both:
 *   - those two summary routes (still always called with the availability
 *     week — unchanged output/behavior, just de-duplicated + timezone-fixed
 *     at the call site via lib/red-artists/week.ts)
 *   - the new /weekly routes (any past/current/future week, for the
 *     navigable calendar)
 *
 * Sessions come from THIS artist's own projects only (project.artist token
 * match; independent title-only sessions are never attributed) — the same
 * server-side scoping the summary routes always had. No money on either
 * list. Shows are filtered to the visible statuses (אושרה/נסגר/בוצע) the
 * portal is already allowed to see.
 */

export type WeeklyItem = {
  id?: string;
  type: string;
  title: string;
  date: string | null;
  startTime: string | null;
  endTime?: string | null;
  location?: string | null;
};

const VISIBLE_SHOW_STATUSES = new Set(["אושרה", "נסגר", "בוצע"]);

function isThisArtist(artist: string, name: string): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(name);
}

type SessionRow = {
  id: string; project_id: string | null; title: string | null; date: string | null;
  start_time: string | null; end_time: string | null; session_type: string | null;
  location: string | null; status: string | null;
};

function byDateTime(a: { date: string | null; startTime?: string | null }, b: { date: string | null; startTime?: string | null }): number {
  const d = (a.date ?? "").localeCompare(b.date ?? "");
  return d !== 0 ? d : (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

export async function fetchArtistWeeklyEvents(artistName: string, weekStart: string, weekEnd: string): Promise<WeeklyItem[]> {
  const { data: projRows } = await supabase.from("projects").select("id, name, artist, is_hidden");
  const artistProjects = (projRows ?? []).filter((p) => !p.is_hidden && isThisArtist(p.artist as string, artistName));
  const projName = new Map(artistProjects.map((p) => [p.id as string, p.name as string]));
  const artistProjectIds = artistProjects.map((p) => p.id as string);

  let sessions: SessionRow[] = [];
  if (artistProjectIds.length > 0) {
    const { data: sessRows } = await supabase
      .from("sessions")
      .select("id, project_id, title, date, start_time, end_time, session_type, location, status")
      .in("project_id", artistProjectIds)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date", { ascending: true });
    sessions = ((sessRows ?? []) as SessionRow[]).filter((s) => s.status !== "בוטל");
  }
  const sessTitle = (s: SessionRow) => s.title || (s.project_id ? projName.get(s.project_id) : null) || (s.session_type || "סשן");

  // All three visible statuses (not just upcoming אושרה/נסגר) — a week in the
  // past may contain a show that already happened (בוצע), and it should still
  // show up when navigating to that week.
  const allShows = await listShows();
  const shows = allShows.filter((s) =>
    isThisArtist(s.artist, artistName) &&
    VISIBLE_SHOW_STATUSES.has(s.status) &&
    !!s.date && s.date >= weekStart && s.date <= weekEnd,
  );

  const items: WeeklyItem[] = [
    ...sessions.map((s) => ({
      id: s.id,
      type: s.session_type || "סשן",
      title: sessTitle(s),
      date: s.date,
      startTime: s.start_time ?? null,
      endTime: s.end_time ?? null,
      location: s.location || null,
    })),
    ...shows.map((sh) => ({
      type: "הופעה",
      title: sh.name,
      date: sh.date,
      startTime: sh.start_time ?? null,
      endTime: null as string | null,
      location: sh.location || null,
    })),
  ].sort(byDateTime);

  return items;
}
