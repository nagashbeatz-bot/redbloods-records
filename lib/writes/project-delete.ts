/**
 * Shared writer for deleting a project (DELETE /api/projects/[id] and Sunny's DELETE_PROJECT). The semantics are the
 * route's (moved verbatim): hard-delete what the project owns, unlink what it does not, soft-close its alerts, delete the
 * project row. HARDENED (2026-09-27, Universal Actions):
 *   • every step's error is checked and the delete ABORTS on the first failure — the project row is deleted LAST, so a
 *     failure leaves the project in place and the delete can simply be retried (every step is idempotent). It used to
 *     ignore every step's error and delete the project anyway, leaving partial data.
 *   • Victor works go through the shared Victor writer, so their follow-up task (+ Google Task) is removed too — the
 *     route used to delete the rows directly and leave their tasks behind.
 * Still not a single database transaction: that needs an approved SQL function (reported, not done here).
 */
import { supabase } from "@/lib/supabase";

const ok = (label: string) => ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(`${label}: ${error.message}`); };
const alertKeys = (projectId: string) => ["overdue_deadline", "deadline_approaching", "project_no_pricing", "completed_no_delivery", "stale_session"].map((t) => `${t}:${projectId}`);

export interface ProjectDeleteImpact {
  sessions: number; calendarEvents: number; sendLog: number; clipRows: number; victorWorks: number; transactionsUnlinked: number; proposalsReset: number;
  engineerWorks: number; albumTracks: number; openAlerts: number; tasksKept: number; meetingsKept: number; productionsKept: number;
}
async function count(table: string, col: string, id: string, extra?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  let q = base(table).eq(col, id); if (extra) q = extra(q);
  const { count: n, error } = await q; if (error) throw new Error(`${table}: ${error.message}`); return n ?? 0;
}
function base(table: string) { return supabase.from(table).select("id", { count: "exact", head: true }); }

/** What a delete would do — counts only (the preview). */
export async function projectDeleteImpact(projectId: string): Promise<ProjectDeleteImpact> {
  const { data: sess, error } = await supabase.from("sessions").select("id, calendar_event_id").eq("project_id", projectId);
  if (error) throw new Error(error.message);
  const { count: openAlerts, error: e2 } = await supabase.from("agent_alerts").select("id", { count: "exact", head: true }).in("entity_key", alertKeys(projectId)).eq("status", "new");
  if (e2) throw new Error(e2.message);
  return {
    sessions: (sess ?? []).length, calendarEvents: (sess ?? []).filter((s) => !!s.calendar_event_id).length,
    sendLog: await count("project_actions", "project_id", projectId), clipRows: await count("clip_items", "project_id", projectId),
    victorWorks: await count("vendor_project_work", "project_id", projectId), transactionsUnlinked: await count("transactions", "project_id", projectId),
    proposalsReset: await count("proposals", "linked_project_id", projectId), engineerWorks: await count("sound_engineer_work", "project_id", projectId),
    albumTracks: await count("album_tracks", "project_id", projectId), openAlerts: openAlerts ?? 0,
    tasksKept: await count("tasks", "related_id", projectId, (q) => q.eq("related_type", "project")), meetingsKept: await count("meetings", "project_id", projectId),
    productionsKept: await count("red_films_productions", "project_id", projectId),
  };
}

/** DELETE /api/projects/[id] semantics, abort-on-failure, project row last. */
export async function deleteProjectCompletely(projectId: string): Promise<void> {
  // 1. sessions + their Google Calendar events (events best-effort, like the route)
  const { data: sess, error: se } = await supabase.from("sessions").select("id, calendar_event_id").eq("project_id", projectId);
  if (se) throw new Error(`sessions: ${se.message}`);
  if (sess?.length) {
    const ids = sess.map((s) => s.calendar_event_id as string | null).filter(Boolean) as string[];
    if (ids.length) {
      try {
        const { deleteCalendarEvent, isConnected } = await import("@/lib/google-calendar");
        if (await isConnected()) await Promise.allSettled(ids.map((id) => deleteCalendarEvent(id)));
      } catch { /* calendar cleanup is non-fatal */ }
    }
    ok("sessions")(await supabase.from("sessions").delete().eq("project_id", projectId));
  }
  // 2. send log, 3. clip plan rows
  ok("project_actions")(await supabase.from("project_actions").delete().eq("project_id", projectId));
  ok("clip_items")(await supabase.from("clip_items").delete().eq("project_id", projectId));
  // 4. Victor (+ future vendor) works — through the shared writer (its follow-up task goes first)
  const { data: works, error: we } = await supabase.from("vendor_project_work").select("id").eq("project_id", projectId);
  if (we) throw new Error(`vendor_project_work: ${we.message}`);
  if (works?.length) {
    const { removeVictorWork } = await import("@/lib/writes/victor");
    for (const w of works) await removeVictorWork(String(w.id));
  }
  // 5. settings finance_ / delivery_, 5b. cover (best-effort, never throws — the store's rule)
  ok("settings")(await supabase.from("settings").delete().in("key", [`finance_${projectId}`, `delivery_${projectId}`]));
  const { cleanupProjectCover } = await import("@/lib/project-cover-store");
  await cleanupProjectCover(projectId);
  // 6. transactions — unlink only, never delete
  ok("transactions")(await supabase.from("transactions").update({ project_id: null, updated_at: new Date().toISOString() }).eq("project_id", projectId));
  // 7. proposals — close their follow-up tasks (non-critical, like the route), then unlink + back to "לא נסגר"
  const { data: props, error: pe } = await supabase.from("proposals").select("id, client_id").eq("linked_project_id", projectId);
  if (pe) throw new Error(`proposals: ${pe.message}`);
  if (props?.length) {
    const { listTasks, deleteTask } = await import("@/lib/tasks-store");
    for (const p of props) {
      if (!p.client_id) continue;
      try {
        const marker = `[proposal_id:${p.id}]`;
        const t = (await listTasks({ related_type: "client", related_id: String(p.client_id) })).find((x) => x.notes?.includes(marker));
        if (t) {
          if (t.calendar_event_id) {
            try { const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar"); if (await isConnected()) await deleteGoogleTask(t.calendar_event_id); } catch { /* non-critical */ }
          }
          await deleteTask(t.id);
        }
      } catch { /* non-critical */ }
    }
  }
  ok("proposals")(await supabase.from("proposals").update({ linked_project_id: null, status: "לא נסגר", updated_at: new Date().toISOString() }).eq("linked_project_id", projectId));
  // 8. agent alerts keyed to the project — soft-closed
  ok("agent_alerts")(await supabase.from("agent_alerts").update({ status: "handled", updated_at: new Date().toISOString() }).in("entity_key", alertKeys(projectId)).eq("status", "new"));
  // 9. the project row LAST (DB cascades: release details, album tracks, engineer work, remaining alerts)
  const { deleteProject } = await import("@/lib/projects-store");
  await deleteProject(projectId);
}
