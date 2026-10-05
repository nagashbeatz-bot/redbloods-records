import "server-only";
import { supabase } from "./supabase";

/**
 * Full-history sessions read — server-only, read-only.
 *
 * app/api/sessions/route.ts already does an equivalent unbounded read inline
 * (`?all=1`: `.from("sessions").select("*").order("date", {ascending:false})`)
 * for its own UI. This is a SEPARATE, narrower-column export for Redbloods
 * Partner (Phase B.2) — deliberately not wired into that route, so its
 * response shape/behavior is completely unaffected by this file.
 */
export interface SessionRow {
  id: string;
  projectId: string | null;
  showId: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  sessionType: string;
  /** who set the current status (CREATED / MANUAL / AUTO_MARK); null = before tracking began (2026-10-01) */
  statusSource: string | null;
  /** when the session row was recorded (= when it was scheduled in Redbloods) — read-only, for "what happened since" */
  createdAt: string | null;
}

/** ALL sessions ever recorded — no date window, one bulk query. */
export async function listAllSessions(): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, project_id, show_id, date, start_time, end_time, status, session_type, status_source, created_at")
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    projectId: (r.project_id as string | null) ?? null,
    showId: (r.show_id as string | null) ?? null,
    date: r.date as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    status: r.status as string,
    sessionType: r.session_type as string,
    statusSource: (r.status_source as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }));
}
