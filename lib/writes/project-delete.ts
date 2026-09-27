/**
 * Shared writer for deleting a project (DELETE /api/projects/[id] and Sunny's DELETE_PROJECT).
 *
 * INTEGRITY FIX A5 (2026-09-27, Owner-approved) — PREFLIGHT FIRST, ZERO MUTATIONS WHEN BLOCKED:
 *   • `projectDeletePreflight` is READ-ONLY. It returns the blockers + every dependent count (what is deleted, what the
 *     database cascades, what is unlinked, what stays). Blocker today: FINAL FILES on the project's mix / engineer works
 *     (final_files.work_id → sound_engineer_work is ON DELETE RESTRICT, and sound_engineer_work → projects CASCADEs,
 *     so the project row delete would fail AFTER every other step had already run). The final files must be removed
 *     first (the Steven / mix final-files screen).
 *   • `deleteProjectCompletely` calls the preflight FIRST and throws ProjectDeleteBlockedError with ZERO mutations.
 *   • Order: DB unlinks / row deletes (each error checked, abort on the first failure — every step is idempotent, a
 *     retry is safe) → a fresh blocker re-check immediately before the project row → the project row (DB cascades:
 *     release details, album tracks, engineer works + versions / comments / attachments, remaining alerts; SET NULL:
 *     final files keyed only by project, proposals, social campaigns) → EXTERNAL effects best-effort AFTER the DB
 *     commit (Google Calendar events, Google Tasks of proposal follow-ups, the custom cover file), reported back.
 *   • Victor works still go through the shared Victor writer (their follow-up task + Google Task go with them).
 * Still not ONE database transaction: that needs an approved SQL function (registered improvement candidate
 * PROJECT.ATOMIC_DELETE_FN; gap PRJ_DELETE_NON_ATOMIC is PARTIALLY_CLOSED).
 */
import { supabase } from "@/lib/supabase";

/** Integration modules, loaded lazily (overridable ONLY by the fake-backed test scripts/test-deletes-ownership.tsx). */
export const PROJECT_DELETE_IO = {
  victor: () => import("@/lib/writes/victor"),
  tasks: () => import("@/lib/tasks-store"),
  google: () => import("@/lib/google-calendar"),
  cover: () => import("@/lib/project-cover-store"),
  projects: () => import("@/lib/projects-store"),
};
const ok = (label: string) => ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(`${label}: ${error.message}`); };
const alertKeys = (projectId: string) => ["overdue_deadline", "deadline_approaching", "project_no_pricing", "completed_no_delivery", "stale_session"].map((t) => `${t}:${projectId}`);

/** Every per-project settings key family the delete removes (A / C families keyed `<prefix><projectId>`). */
export const PROJECT_SETTINGS_PREFIXES = ["finance_", "delivery_", "project_cover_", "session_limit_", "album_finance_", "album_prev_info_", "steven_final_files_requested_project:"] as const;
/** Per-work settings keys removed with the project's engineer works. */
export const WORK_SETTINGS_PREFIX = "steven_final_files_requested:";
export const projectSettingsKeys = (projectId: string, workIds: readonly string[]) => [...PROJECT_SETTINGS_PREFIXES.map((p) => `${p}${projectId}`), ...workIds.map((w) => `${WORK_SETTINGS_PREFIX}${w}`)];

export interface ProjectDeleteImpact {
  // BLOCKER
  finalFilesBlocking: number;
  // deleted by the app
  sessions: number; calendarEvents: number; sendLog: number; clipRows: number; victorWorks: number; settingsKeys: number; coverCustomImage: number; proposalFollowUpTasks: number;
  // cascaded by the database with the project row
  engineerWorks: number; mixVersions: number; mixComments: number; mixAttachments: number; albumTracks: number; releaseDetails: number; openAlerts: number;
  // unlinked (kept)
  transactionsUnlinked: number; sessionLinkedTransactions: number; proposalsReset: number; socialCampaignsUnlinked: number; finalFilesUnlinked: number;
  // kept as they are
  tasksKept: number; meetingsKept: number; productionsKept: number; storageFolderKept: number;
}
export interface ProjectDeleteBlocker { code: "FINAL_FILES"; count: number; messageHe: string }
export interface ProjectDeletePreflight { projectId: string; exists: boolean; name: string; blockers: ProjectDeleteBlocker[]; counts: ProjectDeleteImpact }
export class ProjectDeleteBlockedError extends Error {
  readonly code = "BLOCKED_BY_DEPENDENTS";
  constructor(readonly blockers: ProjectDeleteBlocker[], readonly partial = false) {
    super(`${partial ? "המחיקה נעצרה לפני מחיקת הפרויקט עצמו (חלק מהניקוי כבר בוצע — אפשר לנסות שוב אחרי הטיפול): " : "אי אפשר למחוק את הפרויקט: "}${blockers.map((b) => b.messageHe).join("; ")}`);
  }
}
export const finalFilesBlockerHe = (n: number) => `יש ${n} קבצים סופיים (Final Files) על עבודות המיקס של הפרויקט — מסד הנתונים לא מאפשר למחוק עבודה עם קבצים סופיים. קודם מוחקים את הקבצים הסופיים (מסך הקבצים הסופיים של המיקס), ואז מוחקים את הפרויקט`;

async function ids(table: string, col: string, values: string | readonly string[], extra?: (q: any) => any): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (Array.isArray(values) && values.length === 0) return [];
  let q = supabase.from(table).select("id");
  q = Array.isArray(values) ? q.in(col, values as string[]) : q.eq(col, values as string);
  if (extra) q = extra(q);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return ((data ?? []) as Array<{ id: unknown }>).map((r) => String(r.id));
}
async function count(table: string, col: string, value: string, extra?: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq(col, value);
  if (extra) q = extra(q);
  const { count: n, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}
/** Final files that block (on one of the project's works). A fresh read — used by the preflight AND the re-check. */
async function blockingFinalFiles(projectId: string): Promise<{ workIds: string[]; blocking: number }> {
  const workIds = await ids("sound_engineer_work", "project_id", projectId);
  const blocking = (await ids("final_files", "work_id", workIds)).length;
  return { workIds, blocking };
}

/** READ-ONLY. Blockers + every dependent count. Never writes. */
export async function projectDeletePreflight(projectId: string): Promise<ProjectDeletePreflight> {
  const { data: prj, error: pe } = await supabase.from("projects").select("id, name, dropbox_folder").eq("id", projectId).maybeSingle();
  if (pe) throw new Error(`projects: ${pe.message}`);
  const { workIds, blocking } = await blockingFinalFiles(projectId);
  const { data: sess, error: se } = await supabase.from("sessions").select("id, calendar_event_id").eq("project_id", projectId);
  if (se) throw new Error(`sessions: ${se.message}`);
  const sessionIds = (sess ?? []).map((s) => String(s.id));
  const versionIds = await ids("mix_versions", "sound_engineer_work_id", workIds);
  const commentIds = await ids("mix_comments", "mix_version_id", versionIds);
  const keys = projectSettingsKeys(projectId, workIds);
  const { data: settingRows, error: ke } = await supabase.from("settings").select("key, value").in("key", keys);
  if (ke) throw new Error(`settings: ${ke.message}`);
  const cover = (settingRows ?? []).find((r) => r.key === `project_cover_${projectId}`);
  const projectFinal = await ids("final_files", "project_id", projectId);
  const onWorks = new Set(await ids("final_files", "work_id", workIds));
  const { data: props, error: ppe } = await supabase.from("proposals").select("id, client_id").eq("linked_project_id", projectId);
  if (ppe) throw new Error(`proposals: ${ppe.message}`);
  const counts: ProjectDeleteImpact = {
    finalFilesBlocking: blocking,
    sessions: sessionIds.length, calendarEvents: (sess ?? []).filter((s) => !!s.calendar_event_id).length,
    sendLog: await count("project_actions", "project_id", projectId), clipRows: await count("clip_items", "project_id", projectId),
    victorWorks: await count("vendor_project_work", "project_id", projectId), settingsKeys: (settingRows ?? []).length,
    coverCustomImage: cover && (cover.value as { customImage?: unknown } | null)?.customImage === true ? 1 : 0,
    proposalFollowUpTasks: (props ?? []).filter((p) => !!p.client_id).length,
    engineerWorks: workIds.length, mixVersions: versionIds.length, mixComments: commentIds.length,
    mixAttachments: (await ids("mix_comment_attachments", "comment_id", commentIds)).length,
    albumTracks: await count("album_tracks", "project_id", projectId), releaseDetails: await count("project_release_details", "project_id", projectId),
    openAlerts: await (async () => { const { count: n, error } = await supabase.from("agent_alerts").select("id", { count: "exact", head: true }).in("entity_key", alertKeys(projectId)).eq("status", "new"); if (error) throw new Error(`agent_alerts: ${error.message}`); return n ?? 0; })(),
    transactionsUnlinked: await count("transactions", "project_id", projectId),
    sessionLinkedTransactions: (await ids("transactions", "linked_session_id", sessionIds)).length,
    proposalsReset: (props ?? []).length, socialCampaignsUnlinked: await count("social_campaigns", "project_id", projectId),
    finalFilesUnlinked: projectFinal.filter((id) => !onWorks.has(id)).length,
    tasksKept: await count("tasks", "related_id", projectId, (q) => q.eq("related_type", "project")), meetingsKept: await count("meetings", "project_id", projectId),
    productionsKept: await count("red_films_productions", "project_id", projectId), storageFolderKept: prj?.dropbox_folder ? 1 : 0,
  };
  const blockers: ProjectDeleteBlocker[] = blocking > 0 ? [{ code: "FINAL_FILES", count: blocking, messageHe: finalFilesBlockerHe(blocking) }] : [];
  return { projectId, exists: !!prj, name: String(prj?.name ?? ""), blockers, counts };
}

/** What a delete would do — counts only (the preview). */
export async function projectDeleteImpact(projectId: string): Promise<ProjectDeleteImpact> {
  return (await projectDeletePreflight(projectId)).counts;
}

export interface ProjectDeleteExternalEffect { kind: "CALENDAR_EVENT" | "GOOGLE_TASK" | "COVER_FILE"; attempted: number; failed: number; skippedReason?: string }
export interface ProjectDeleteResult { deleted: true; counts: ProjectDeleteImpact; external: ProjectDeleteExternalEffect[] }

/** DELETE /api/projects/[id] semantics: preflight (zero mutations when blocked) → DB → re-check → project row → external. */
export async function deleteProjectCompletely(projectId: string): Promise<ProjectDeleteResult> {
  // 0. PREFLIGHT — read-only; blocked → nothing at all is written
  const pre = await projectDeletePreflight(projectId);
  if (!pre.exists) throw new Error("project not found");
  if (pre.blockers.length) throw new ProjectDeleteBlockedError(pre.blockers);

  // collect the external targets now (read-only) — they are acted on only after the DB commit
  const { data: sess, error: se } = await supabase.from("sessions").select("id, calendar_event_id").eq("project_id", projectId);
  if (se) throw new Error(`sessions: ${se.message}`);
  const calendarEventIds = (sess ?? []).map((s) => s.calendar_event_id as string | null).filter((x): x is string => !!x);
  const googleTaskIds: string[] = [];
  const coverCustomImage = pre.counts.coverCustomImage > 0;

  // 1. DB — sessions, send log, clip plan rows
  if (sess?.length) ok("sessions")(await supabase.from("sessions").delete().eq("project_id", projectId));
  ok("project_actions")(await supabase.from("project_actions").delete().eq("project_id", projectId));
  ok("clip_items")(await supabase.from("clip_items").delete().eq("project_id", projectId));
  // 2. Victor (+ future vendor) works — through the shared writer (its follow-up task goes first)
  const works = await ids("vendor_project_work", "project_id", projectId);
  if (works.length) {
    const { removeVictorWork } = await PROJECT_DELETE_IO.victor();
    for (const w of works) await removeVictorWork(w);
  }
  // 3. every per-project settings key (+ the per-work final-files request flags of the project's works)
  const workIds = await ids("sound_engineer_work", "project_id", projectId);
  ok("settings")(await supabase.from("settings").delete().in("key", projectSettingsKeys(projectId, workIds)));
  // 4. transactions — unlink only, never delete (real money stays)
  ok("transactions")(await supabase.from("transactions").update({ project_id: null, updated_at: new Date().toISOString() }).eq("project_id", projectId));
  // 5. proposals — remove their follow-up task rows (Google Task after the commit), then unlink + back to "לא נסגר"
  const { data: props, error: pe } = await supabase.from("proposals").select("id, client_id").eq("linked_project_id", projectId);
  if (pe) throw new Error(`proposals: ${pe.message}`);
  if (props?.length) {
    const { listTasks, deleteTask } = await PROJECT_DELETE_IO.tasks();
    for (const p of props) {
      if (!p.client_id) continue;
      const marker = `[proposal_id:${p.id}]`;
      const t = (await listTasks({ related_type: "client", related_id: String(p.client_id) })).find((x) => x.notes?.includes(marker));
      if (t) { if (t.calendar_event_id) googleTaskIds.push(t.calendar_event_id); await deleteTask(t.id); }
    }
  }
  ok("proposals")(await supabase.from("proposals").update({ linked_project_id: null, status: "לא נסגר", updated_at: new Date().toISOString() }).eq("linked_project_id", projectId));
  // 6. agent alerts keyed to the project — soft-closed
  ok("agent_alerts")(await supabase.from("agent_alerts").update({ status: "handled", updated_at: new Date().toISOString() }).in("entity_key", alertKeys(projectId)).eq("status", "new"));
  // 7. RE-CHECK the blocker immediately before the project row (a final file may have been added meanwhile)
  const re = await blockingFinalFiles(projectId);
  if (re.blocking > 0) throw new ProjectDeleteBlockedError([{ code: "FINAL_FILES", count: re.blocking, messageHe: finalFilesBlockerHe(re.blocking) }], true);
  // 8. the project row (DB cascades: release details, album tracks, engineer works + versions / comments / attachments)
  const { deleteProject } = await PROJECT_DELETE_IO.projects();
  await deleteProject(projectId);

  // 9. EXTERNAL effects — best-effort, AFTER the DB commit, reported (never silently swallowed)
  const external: ProjectDeleteExternalEffect[] = [];
  if (calendarEventIds.length || googleTaskIds.length) {
    let connected = false;
    try { const g = await PROJECT_DELETE_IO.google(); connected = await g.isConnected(); } catch { connected = false; }
    const run = async (kind: "CALENDAR_EVENT" | "GOOGLE_TASK", list: string[]) => {
      if (!list.length) return;
      if (!connected) { external.push({ kind, attempted: 0, failed: list.length, skippedReason: "Google לא מחובר — לא נמחק ביומן" }); return; }
      const g = await PROJECT_DELETE_IO.google();
      const r = await Promise.allSettled(list.map((id) => (kind === "CALENDAR_EVENT" ? g.deleteCalendarEvent(id) : g.deleteGoogleTask(id))));
      external.push({ kind, attempted: list.length, failed: r.filter((x) => x.status === "rejected").length });
    };
    await run("CALENDAR_EVENT", calendarEventIds);
    await run("GOOGLE_TASK", googleTaskIds);
  }
  if (coverCustomImage) {
    const { deleteProjectCoverFile } = await PROJECT_DELETE_IO.cover();
    external.push({ kind: "COVER_FILE", attempted: 1, failed: (await deleteProjectCoverFile(projectId)) ? 0 : 1 });
  }
  return { deleted: true, counts: pre.counts, external };
}
