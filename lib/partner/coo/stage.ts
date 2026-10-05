/**
 * Sunny COO — the ONE rule for "how far along is this project" (pure, read-only, Owner mission 2026-10-05 Phase 2).
 * Shared by readiness (deadline checks) and BUSINESS_MOTION, so both answer the same way.
 *
 *   completionEvidence  the records show the work itself is done: an engineer work APPROVED (אושר) with final files
 *                       uploaded, no other engineer work open, no Victor production still active. A payment alone NEVER
 *                       proves completion (paid ≠ approved ≠ final files). It never changes the project status — it is a
 *                       CLOSE_LOOP candidate the Owner confirms (UPDATE_PROJECT_STATUS after his approval).
 *   stageBehind         the stage looks materially behind a delivery: the project is still before the mix (לא התחיל /
 *                       בעבודה / מחכה למיקס) and no engineer work is open. What the deadline includes is NOT known — the
 *                       wording always says so (never "the mix must be ready by …").
 */
import type { CooCtx } from "./context";
import { heDate, ymdOf } from "./model";

const CLOSED = new Set(["הושלם", "בוטל", "בהשהייה"]);
const ENGINEER_DONE = new Set(["אושר", "בוטל"]);
export const ENGINEER_APPROVED = "אושר";
/** statuses before the mix (the app's own project status vocabulary) */
export const BEFORE_MIX_STATUSES: ReadonlySet<string> = new Set(["לא התחיל", "בעבודה", "מחכה למיקס"]);
export const WAITING_FOR_MIX = "מחכה למיקס";

export interface CompletionEvidence {
  complete: boolean;
  approvedWithFinals: Array<{ workId: string; engineer: string; finals: number; lastFinalAt: string | null }>;
  openEngineerWork: number;
  activeVictor: number;
  /** a paid engineer expense / client payment is context only — never part of the completion decision */
  he: string | null;
}

export function engineerWorksOf(c: CooCtx, projectId: string) {
  return (c.ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === projectId && (w.status ?? "") !== "בוטל");
}

export function completionEvidence(c: CooCtx, projectId: string): CompletionEvidence | null {
  const status = c.project(projectId).identity?.status ?? null;
  if (!status || CLOSED.has(status)) return null;
  const works = engineerWorksOf(c, projectId);
  const finals = (c.ops?.finalFiles?.rows ?? []);
  const approvedWithFinals = works.filter((w) => w.status === ENGINEER_APPROVED).map((w) => {
    const f = finals.filter((x) => x.workId === w.id);
    return { workId: w.id, engineer: w.engineerName ?? "המהנדס", finals: f.length, lastFinalAt: f.map((x) => x.createdAt ?? "").filter(Boolean).sort().at(-1) ?? null };
  }).filter((w) => w.finals > 0);
  const openEngineerWork = works.filter((w) => !ENGINEER_DONE.has(w.status ?? "")).length;
  const activeVictor = (c.st?.domains.victor.data?.active ?? []).filter((w) => w.projectId === projectId).length;
  const complete = approvedWithFinals.length > 0 && openEngineerWork === 0 && activeVictor === 0;
  const a = approvedWithFinals[0];
  return { complete, approvedWithFinals, openEngineerWork, activeVictor,
    he: complete ? `עבודת המיקס (${a.engineer}) מסומנת 'אושר' והקבצים הסופיים הועלו${a.lastFinalAt ? ` (${heDate(ymdOf(a.lastFinalAt))})` : ""}, והסטטוס עדיין "${status}"` : null };
}

export interface StageVerdict { behind: boolean; status: string | null; he: string }

export function stageBehind(c: CooCtx, projectId: string): StageVerdict {
  const status = c.project(projectId).identity?.status ?? null;
  if (!status || CLOSED.has(status)) return { behind: false, status, he: "" };
  const comp = completionEvidence(c, projectId);
  if (comp?.complete) return { behind: false, status, he: comp.he ?? "" };
  if (engineerWorksOf(c, projectId).some((w) => !ENGINEER_DONE.has(w.status ?? ""))) return { behind: false, status, he: "יש עבודה פתוחה אצל מהנדס" };
  if (!BEFORE_MIX_STATUSES.has(status)) return { behind: false, status, he: "" };
  return { behind: true, status, he: `הסטטוס "${status}" ואין עבודת מיקס פתוחה` };
}

export const STAGE_UNCERTAINTY_HE = "אני לא יודעת בדיוק מה כלול בדדליין";
