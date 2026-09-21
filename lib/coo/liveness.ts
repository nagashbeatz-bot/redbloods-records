/**
 * Live activity — PURE and deterministic. Separates "a project somebody is working on
 * right now" from "a project that only carries old metadata".
 *
 * It is a plain list of boolean signs, NOT a score. Every sign carries its evidence
 * (source + asOf), so the "למה?" panel can show exactly why a project counts as live.
 *
 * "Live" only says the PROJECT is being worked on. It never proves that an old project
 * deadline is still valid: `projects.updated_at` also moves on file uploads, and a planned
 * session or an open Steven work says the project is alive, not that its old date is right.
 * So liveness lifts the priority of a RECENT overdue deadline (1–13 days), and is shown next to
 * a STALE deadline (30+ days) — it never rescues one. IDs only: every sign comes from a field
 * that carries the project id.
 */
import type { CooConfig } from "./config";
import type { CompanyState, Evidence, ProjectFact } from "./types";

export type LiveKind = "updated_recently" | "steven_open_work" | "session_planned" | "task_recent" | "release_near";

export interface LiveSign {
  kind: LiveKind;
  text: string;
  evidence: Evidence;
}

export interface Liveness {
  live: boolean;
  signs: LiveSign[];
}

export function projectLiveness(state: CompanyState, p: ProjectFact, cfg: CooConfig): Liveness {
  const asOf = state.meta.asOf;
  const signs: LiveSign[] = [];
  const ev = (id: string, label: string, value: Evidence["value"], display: string, kind: Evidence["kind"], source: Evidence["source"]): Evidence =>
    ({ id, label, value, display, kind, source, asOf });

  if (p.daysSinceUpdate !== null && p.daysSinceUpdate <= cfg.liveness.updatedWithinDays) {
    signs.push({
      kind: "updated_recently", text: `הפרויקט עודכן לפני ${p.daysSinceUpdate} ימים`,
      evidence: ev(`${p.id}:live:updated`, "עודכן לאחרונה (ימים)", p.daysSinceUpdate, String(p.daysSinceUpdate), "days", { table: "projects", id: p.id, field: "updated_at" }),
    });
  }

  const sw = (state.team.steven?.open ?? []).filter((w) => w.projectId === p.id);
  if (sw.length > 0) {
    signs.push({
      kind: "steven_open_work", text: `${sw.length === 1 ? "עבודת Steven פתוחה" : `${sw.length} עבודות Steven פתוחות`} על הפרויקט`,
      evidence: ev(`${p.id}:live:steven`, "עבודות Steven פתוחות על הפרויקט", sw.length, String(sw.length), "count", { table: "sound_engineer_work", field: "project_id" }),
    });
  }

  const sess = (state.sessions ?? []).filter((s) => s.projectId === p.id);
  if (sess.length > 0) {
    const d = Math.min(...sess.map((s) => s.daysTo));
    signs.push({
      kind: "session_planned", text: `סשן מתוכנן בעוד ${d} ימים`,
      evidence: ev(`${p.id}:live:session`, "ימים לסשן מתוכנן", d, String(d), "days", { table: "sessions", field: "project_id" }),
    });
  }

  // tasks carry no reliable created/updated date, so "recent" means: due ahead, or due within the last N days.
  const recentTasks = (state.tasks?.items ?? []).filter((t) => t.projectId === p.id && t.daysOverdue !== null && t.daysOverdue <= cfg.liveness.taskRecentDays);
  if (recentTasks.length > 0) {
    signs.push({
      kind: "task_recent", text: `${recentTasks.length} משימות פתוחות מקושרות עם יעד עדכני`,
      evidence: ev(`${p.id}:live:tasks`, "משימות מקושרות עם יעד עדכני", recentTasks.length, String(recentTasks.length), "count", { table: "tasks", field: "related_id" }),
    });
  }

  const rel = (state.releases?.rows ?? []).find((r) => r.projectId === p.id);
  if (rel && rel.daysTo !== null && rel.daysTo >= 0 && rel.daysTo <= cfg.releaseWindowDays) {
    signs.push({
      kind: "release_near", text: `יעד ריליס בעוד ${rel.daysTo} ימים`,
      evidence: ev(`${p.id}:live:release`, "ימים ליעד ריליס", rel.daysTo, String(rel.daysTo), "days", { table: "project_release_details", id: p.id, field: "release_target_date" }),
    });
  }

  return { live: signs.length > 0, signs };
}
