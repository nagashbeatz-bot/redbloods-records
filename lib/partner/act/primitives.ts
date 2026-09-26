/**
 * SUNNY UNIVERSAL ACTION LAYER — the WAVE 1 typed primitives (pure over injected writer deps).
 *
 * Each primitive is ONE narrow, reversible, internal edit that reuses the SAME shared server writer the Redbloods UI
 * uses (updateProject / updateReleaseDetails / updateMixCommentStatus / updateMixVersion / updateLabelArtist /
 * updateVictorWork). No push, no email, no calendar, no Google Tasks, no files, no finance, no delete, no bulk.
 *
 * A primitive: resolves + type-checks its target entity, reads the live fields it will touch, validates the typed
 * arguments, computes the exact after-values (no-op → refused), writes ONLY those fields through the shared writer, and
 * verifies by a fresh read. The executor is chosen only by the registered action id.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./plan";
import { ENTITY_KEY_RE, MAX_TEXT_CHARS } from "./persist";
import type { PlanStep } from "./types";
import type { PrimitiveExecutor } from "./engine";
import { LABEL_ARTIST_STATUSES, PROJECT_TYPES, RELEASE_STAGES, VICTOR_OUTCOMES, VICTOR_WORK_STATES } from "@/lib/types";

export type Scalar = string | number | boolean | null;
export type Fields = Record<string, Scalar>;
export const MIX_VERSION_STATUSES = ["בבדיקה", "מוכן", "מאושר", "נדחה"] as const;

/** The shared writers + narrow readers each primitive may use (real ones in server.ts; fakes in tests). */
export interface WriterDeps {
  readProject(id: string): Promise<{ name: string; notes: string; startDate: string | null; plannedHours: number | null; plannedDays: number | null; projectType: string; parentProject: string; deadline: string | null } | null>;
  writeProject(id: string, patch: Partial<{ notes: string; start_date: string | null; planned_hours: number | null; planned_days: number | null; project_type: string; parent_project: string; deadline: string | null }>): Promise<void>;
  readRelease(projectId: string): Promise<{ projectName: string; releaseStage: string; releaseTargetDate: string | null; nextAction: string; blocker: string; responsible: string; updatedAt: string } | null>;
  writeRelease(projectId: string, expectedUpdatedAt: string, patch: Partial<{ releaseStage: string; releaseTargetDate: string | null; nextAction: string; blocker: string; responsible: string }>): Promise<"ok" | "conflict" | "not_found">;
  readMixWork(id: string): Promise<{ title: string } | null>;
  listMixVersions(workId: string): Promise<Array<{ id: string; label: string; status: string; createdAt: string }>>;
  listMixComments(workId: string): Promise<Array<{ id: string; versionId: string; versionLabel: string; text: string; status: string; timestampSeconds: number | null; createdAt: string }>>;
  readMixComment(id: string): Promise<{ workId: string; versionLabel: string; text: string; status: string } | null>;
  writeMixCommentStatus(id: string, status: "open" | "resolved"): Promise<void>;
  readMixVersion(id: string): Promise<{ workId: string; label: string; status: string } | null>;
  writeMixVersion(id: string, patch: { status?: string; label?: string }): Promise<void>;
  readLabelArtist(id: string): Promise<{ name: string; notes: string; status: string } | null>;
  writeLabelArtist(id: string, patch: { notes?: string; status?: string }): Promise<"ok" | "not_found" | "duplicate">;
  readVictorWork(id: string): Promise<{ title: string; vendorName: string; workState: string | null; outcome: string | null; notes: string } | null>;
  writeVictorWork(id: string, patch: Partial<{ workState: string; outcome: string; notes: string }>): Promise<void>;
}

export type PlanRefusal = { ok: false; code: string; messageHe: string };
export interface ResolvedTarget { key: string; id: string; label: string; fields: Fields }
export interface PrimitiveSpec {
  actionId: string;
  /** The entity kind(s) the target key must have. */
  kinds: readonly string[];
  /** Resolve the target from the typed args (direct key, or a parent key + a deterministic selector). */
  resolve(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal>;
  /** Re-read the same target by id (fingerprint / verify). */
  read(d: WriterDeps, id: string): Promise<Fields | null>;
  /** Validate the typed args against the live fields → the exact after-values of the changed fields only. */
  plan(args: Readonly<Record<string, unknown>>, current: Fields): { ok: true; after: Fields } | PlanRefusal;
  /** Write ONLY `after` through the shared writer. */
  apply(d: WriterDeps, id: string, after: Fields): Promise<void>;
  /** What the preview must say will NOT happen / derived same-record effects. */
  disclosuresHe: readonly string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const refuse = (code: string, messageHe: string): PlanRefusal => ({ ok: false, code, messageHe });
const isRefusal = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;
export function parseKey(v: unknown, kinds: readonly string[]): { kind: string; id: string } | null {
  if (typeof v !== "string" || !ENTITY_KEY_RE.test(v)) return null;
  const i = v.indexOf(":");
  const kind = v.slice(0, i), id = v.slice(i + 1);
  return kinds.includes(kind) && /^[0-9a-f-]{36}$/i.test(id) ? { kind, id: id.toLowerCase() } : null;
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const realYmd = (v: unknown): v is string => typeof v === "string" && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = (v: unknown, max = MAX_TEXT_CHARS): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null);
const COMMON_NO = ["לא יישלח Push, מייל או הודעה לאף אחד", "היומן ו-Google Tasks לא משתנים", "שום קובץ ושום רשומה כספית לא משתנים"];
/** Notes edit: REPLACE sets the text; APPEND adds a new line after the current text. */
function notesAfter(args: Readonly<Record<string, unknown>>, current: string, argName: string): string | PlanRefusal {
  const t = text(args[argName]);
  if (t === null) return refuse("BAD_TEXT", `חסר טקסט ל-${argName} (עד ${MAX_TEXT_CHARS} תווים)`);
  if (args.mode !== "REPLACE" && args.mode !== "APPEND") return refuse("BAD_MODE", "צריך לבחור: להחליף את ההערה או להוסיף לה");
  const after = args.mode === "APPEND" ? (current.trim() ? `${current.trimEnd()}\n${t.trim()}` : t.trim()) : t.trim();
  return after;
}
const unchanged = (current: Fields, after: Fields) => Object.keys(after).every((k) => current[k] === after[k]);
const noChange = () => refuse("NO_CHANGE_NEEDED", "זה כבר המצב הנוכחי — אין מה לשנות");
function finishPlan(current: Fields, after: Fields): { ok: true; after: Fields } | PlanRefusal {
  if (!Object.keys(after).length) return refuse("NOTHING_TO_CHANGE", "לא ציינת מה לשנות");
  return unchanged(current, after) ? noChange() : { ok: true, after };
}

// ── readers shared by several primitives ────────────────────────────────────────────────────────────────────────────
async function projectFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const p = await d.readProject(id);
  return p ? { name: p.name, notes: p.notes, startDate: p.startDate, plannedHours: p.plannedHours, plannedDays: p.plannedDays, projectType: p.projectType, parentProject: p.parentProject, deadline: p.deadline } : null;
}
async function resolveProject(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.project, ["project"]);
  if (!k) return refuse("BAD_ENTITY", "צריך מפתח פרויקט תקין (project:…)");
  const f = await projectFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  return { key: `project:${k.id}`, id: k.id, label: String(f.name), fields: f };
}
const PROJECT_READ = (d: WriterDeps, id: string) => projectFields(d, id);
async function releaseFields(d: WriterDeps, projectId: string): Promise<Fields | null> {
  const r = await d.readRelease(projectId);
  return r ? { projectName: r.projectName, releaseStage: r.releaseStage, releaseTargetDate: r.releaseTargetDate, nextAction: r.nextAction, blocker: r.blocker, responsible: r.responsible, updatedAt: r.updatedAt } : null;
}
async function resolveRelease(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.project, ["project", "release"]);
  if (!k) return refuse("BAD_ENTITY", "צריך מפתח פרויקט תקין (project:…)");
  const f = await releaseFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לפרויקט הזה אין רשומת ריליס (הוא לא ריליס של הלייבל)");
  return { key: `project:${k.id}`, id: k.id, label: String(f.projectName), fields: f };
}
async function commentFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const c = await d.readMixComment(id);
  return c ? { workId: c.workId, versionLabel: c.versionLabel, text: c.text, status: c.status } : null;
}
function resolveComment(want: "resolved" | "open") {
  return async (d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> => {
    const direct = parseKey(args.mixComment, ["mix-comment"]);
    let id: string | null = direct?.id ?? null;
    if (!id) {
      const w = parseKey(args.mixWork, ["mix-work"]);
      if (!w) return refuse("BAD_ENTITY", "צריך עבודת מיקס (mix-work:…) או הערה מסוימת (mix-comment:…)");
      if (args.which !== "LATEST" && args.which !== (want === "resolved" ? "LATEST_OPEN" : "LATEST_RESOLVED")) return refuse("BAD_SELECTOR", "איזו הערה? (האחרונה / האחרונה הפתוחה / האחרונה שטופלה)");
      if (!(await d.readMixWork(w.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת המיקס");
      const all = (await d.listMixComments(w.id)).filter((c) => args.which === "LATEST" || c.status === (want === "resolved" ? "open" : "resolved"));
      if (!all.length) return refuse("ENTITY_NOT_FOUND", want === "resolved" ? "אין הערה פתוחה בעבודת המיקס הזאת" : "אין הערה שסומנה כטופלה בעבודת המיקס הזאת");
      id = [...all].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))[0].id;
    }
    const f = await commentFields(d, id);
    if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההערה");
    return { key: `mix-comment:${id}`, id, label: `הערה ב-${f.versionLabel || "גרסה"}`, fields: f };
  };
}
async function versionFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const v = await d.readMixVersion(id);
  return v ? { workId: v.workId, label: v.label, status: v.status } : null;
}
async function resolveVersion(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  let id = parseKey(args.mixVersion, ["mix-version"])?.id ?? null;
  if (!id) {
    const w = parseKey(args.mixWork, ["mix-work"]);
    if (!w || args.which !== "LATEST") return refuse("BAD_ENTITY", "צריך גרסה מסוימת (mix-version:…) או עבודת מיקס + 'האחרונה'");
    if (!(await d.readMixWork(w.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת המיקס");
    const vs = await d.listMixVersions(w.id);
    if (!vs.length) return refuse("ENTITY_NOT_FOUND", "אין גרסאות בעבודת המיקס הזאת");
    id = [...vs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0].id; // newest upload, never the highest number
  }
  const f = await versionFields(d, id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הגרסה");
  return { key: `mix-version:${id}`, id, label: `גרסה ${f.label}`, fields: f };
}
async function artistFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const a = await d.readLabelArtist(id);
  return a ? { name: a.name, notes: a.notes, status: a.status } : null;
}
async function victorFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const w = await d.readVictorWork(id);
  return w ? { title: w.title, vendorName: w.vendorName, workState: w.workState, outcome: w.outcome, notes: w.notes } : null;
}
async function resolveVictor(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.victorWork, ["victor-work"]);
  if (!k) return refuse("BAD_ENTITY", "צריך עבודה של ויקטור (victor-work:…)");
  const f = await victorFields(d, k.id);
  if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את העבודה");
  if (f.vendorName !== "victor") return refuse("WRONG_ENTITY_TYPE", "זו לא עבודה של ויקטור");
  return { key: `victor-work:${k.id}`, id: k.id, label: String(f.title), fields: f };
}

// ── the Wave 1 primitives ───────────────────────────────────────────────────────────────────────────────────────────
export const WAVE1_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "UPDATE_PROJECT_NOTES", kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
    plan(args, cur) { const a = notesAfter(args, String(cur.notes ?? ""), "notes"); return isRefusal(a) ? a : finishPlan(cur, { notes: a }); },
    apply: (d, id, after) => d.writeProject(id, { notes: String(after.notes) }),
    disclosuresHe: [...COMMON_NO, "רק שדה ההערות של הפרויקט משתנה"],
  },
  {
    actionId: "UPDATE_PROJECT_PLANNING", kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
    plan(args, cur) {
      const after: Fields = {};
      if (args.startDate !== undefined) { if (!realYmd(args.startDate)) return refuse("BAD_DATE", "תאריך התחלה לא תקין (YYYY-MM-DD)"); after.startDate = args.startDate; }
      if (args.plannedHours !== undefined) { const n = args.plannedHours; if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10000) return refuse("BAD_NUMBER", "שעות מתוכננות לא תקינות"); after.plannedHours = n; }
      if (args.plannedDays !== undefined) { const n = args.plannedDays; if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10000) return refuse("BAD_NUMBER", "ימים מתוכננים חייבים להיות מספר שלם לא שלילי"); after.plannedDays = n; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.writeProject(id, { ...("startDate" in a ? { start_date: a.startDate as string } : {}), ...("plannedHours" in a ? { planned_hours: a.plannedHours as number } : {}), ...("plannedDays" in a ? { planned_days: a.plannedDays as number } : {}) }),
    disclosuresHe: [...COMMON_NO, "רק תאריך ההתחלה / השעות / הימים המתוכננים משתנים"],
  },
  {
    actionId: "UPDATE_PROJECT_TYPE_OR_PARENT", kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
    plan(args, cur) {
      const after: Fields = {};
      if (args.projectType !== undefined) { if (!(PROJECT_TYPES as readonly string[]).includes(String(args.projectType))) return refuse("BAD_ENUM", "סוג פרויקט לא מוכר"); after.projectType = String(args.projectType); }
      if (args.parentProject !== undefined) { const t = text(args.parentProject, 200); if (t === null) return refuse("BAD_TEXT", "שם פרויקט האב חסר או ארוך מדי"); after.parentProject = t.trim(); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.writeProject(id, { ...("projectType" in a ? { project_type: String(a.projectType) } : {}), ...("parentProject" in a ? { parent_project: String(a.parentProject) } : {}) }),
    disclosuresHe: [...COMMON_NO, "פרויקט אב נשמר כשם בלבד — לא קישור לרשומה"],
  },
  {
    actionId: "UPDATE_PROJECT_DEADLINE", kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
    plan(args, cur) { if (!realYmd(args.deadline)) return refuse("BAD_DATE", "דדליין לא תקין (YYYY-MM-DD)"); return finishPlan(cur, { deadline: args.deadline }); },
    apply: (d, id, a) => d.writeProject(id, { deadline: String(a.deadline) }),
    disclosuresHe: [...COMMON_NO, "רק הדדליין של הפרויקט משתנה (לא דדליינים של ויקטור / סטיבן)"],
  },
  {
    actionId: "UPDATE_RELEASE_DETAILS", kinds: ["project", "release"], resolve: resolveRelease, read: releaseFields,
    plan(args, cur) {
      const after: Fields = {};
      if (args.releaseTargetDate !== undefined) { if (!realYmd(args.releaseTargetDate)) return refuse("BAD_DATE", "תאריך יעד לא תקין"); after.releaseTargetDate = args.releaseTargetDate; }
      for (const k of ["nextAction", "blocker", "responsible"] as const) if (args[k] !== undefined) { const t = text(args[k], 500); if (t === null) return refuse("BAD_TEXT", `ערך לא תקין ל-${k}`); after[k] = t.trim(); }
      return finishPlan(cur, after);
    },
    apply: async (d, id, a) => {
      const cur = await d.readRelease(id);
      if (!cur) throw new Error("release not found");
      const r = await d.writeRelease(id, cur.updatedAt, { ...("releaseTargetDate" in a ? { releaseTargetDate: String(a.releaseTargetDate) } : {}), ...("nextAction" in a ? { nextAction: String(a.nextAction) } : {}), ...("blocker" in a ? { blocker: String(a.blocker) } : {}), ...("responsible" in a ? { responsible: String(a.responsible) } : {}) });
      if (r !== "ok") throw new Error(r === "conflict" ? "the release changed meanwhile (optimistic lock)" : "release not found");
    },
    disclosuresHe: [...COMMON_NO, "שלב הריליס לא משתנה"],
  },
  {
    actionId: "CHANGE_RELEASE_STAGE", kinds: ["project", "release"], resolve: resolveRelease, read: releaseFields,
    plan(args, cur) { if (!(RELEASE_STAGES as readonly string[]).includes(String(args.releaseStage))) return refuse("BAD_ENUM", "שלב ריליס לא מוכר"); return finishPlan(cur, { releaseStage: String(args.releaseStage) }); },
    apply: async (d, id, a) => {
      const cur = await d.readRelease(id);
      if (!cur) throw new Error("release not found");
      const r = await d.writeRelease(id, cur.updatedAt, { releaseStage: String(a.releaseStage) });
      if (r !== "ok") throw new Error(r === "conflict" ? "the release changed meanwhile (optimistic lock)" : "release not found");
    },
    disclosuresHe: [...COMMON_NO, "באותה רשומה: 'זמן בשלב' מתאפס; מעבר ל'יצא' רושם תאריך יציאה, ויציאה מ'יצא' מוחקת אותו (כמו באפליקציה)"],
  },
  {
    actionId: "RESOLVE_MIX_COMMENT", kinds: ["mix-comment", "mix-work"], resolve: resolveComment("resolved"), read: commentFields,
    plan: (_args, cur) => finishPlan(cur, { status: "resolved" }),
    apply: (d, id) => d.writeMixCommentStatus(id, "resolved"),
    disclosuresHe: [...COMMON_NO, "טקסט ההערה לא משתנה; סטיבן לא מקבל הודעה", "סומן כטופל ≠ המיקס אושר"],
  },
  {
    actionId: "REOPEN_MIX_COMMENT", kinds: ["mix-comment", "mix-work"], resolve: resolveComment("open"), read: commentFields,
    plan: (_args, cur) => finishPlan(cur, { status: "open" }),
    apply: (d, id) => d.writeMixCommentStatus(id, "open"),
    disclosuresHe: [...COMMON_NO, "טקסט ההערה לא משתנה; סטיבן לא מקבל הודעה"],
  },
  {
    actionId: "UPDATE_MIX_VERSION_STATUS_OR_LABEL", kinds: ["mix-version", "mix-work"], resolve: resolveVersion, read: versionFields,
    plan(args, cur) {
      const after: Fields = {};
      if (args.status !== undefined) { if (!(MIX_VERSION_STATUSES as readonly string[]).includes(String(args.status))) return refuse("BAD_ENUM", "סטטוס גרסה לא מוכר"); after.status = String(args.status); }
      if (args.versionLabel !== undefined) { const t = text(args.versionLabel, 100); if (t === null) return refuse("BAD_TEXT", "תווית גרסה חסרה או ארוכה מדי"); after.label = t.trim(); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.writeMixVersion(id, { ...("status" in a ? { status: String(a.status) } : {}), ...("label" in a ? { label: String(a.label) } : {}) }),
    disclosuresHe: [...COMMON_NO, "קובץ הגרסה לא משתנה; עבודת המיקס לא מסומנת כהושלמה", "גרסה 'מאושר' ≠ העבודה הושלמה ≠ קבצים סופיים ≠ שולם"],
  },
  {
    actionId: "UPDATE_LABEL_ARTIST_NOTES_STATUS", kinds: ["label-artist"],
    async resolve(d, args) {
      const k = parseKey(args.labelArtist, ["label-artist"]);
      if (!k) return refuse("BAD_ENTITY", "צריך אמן לייבל (label-artist:…)");
      const f = await artistFields(d, k.id);
      return f ? { key: `label-artist:${k.id}`, id: k.id, label: String(f.name), fields: f } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את האמן");
    },
    read: artistFields,
    plan(args, cur) {
      const after: Fields = {};
      if (args.notes !== undefined) { const a = notesAfter(args, String(cur.notes ?? ""), "notes"); if (isRefusal(a)) return a; after.notes = a; }
      if (args.status !== undefined) { if (!(LABEL_ARTIST_STATUSES as readonly string[]).includes(String(args.status))) return refuse("BAD_ENUM", "סטטוס אמן לא מוכר"); after.status = String(args.status); }
      return finishPlan(cur, after);
    },
    async apply(d, id, a) { const r = await d.writeLabelArtist(id, { ...("notes" in a ? { notes: String(a.notes) } : {}), ...("status" in a ? { status: String(a.status) } : {}) }); if (r !== "ok") throw new Error(`label artist write: ${r}`); },
    disclosuresHe: [...COMMON_NO, "שם האמן, תמונה, מאזן והפורטל לא משתנים"],
  },
  {
    actionId: "UPDATE_VICTOR_WORK_STATE", kinds: ["victor-work"], resolve: resolveVictor, read: victorFields,
    plan(args, cur) { if (!(VICTOR_WORK_STATES as readonly string[]).includes(String(args.workState))) return refuse("BAD_ENUM", "מצב עבודה לא מוכר"); return finishPlan(cur, { workState: String(args.workState) }); },
    apply: (d, id, a) => d.writeVictorWork(id, { workState: String(a.workState) }),
    disclosuresHe: [...COMMON_NO, "ויקטור לא מקבל הודעה; הסטטוס (פעיל / הושלם) והדדליין לא משתנים", "מצב העבודה הוא תצוגה בלבד — הוא לא קובע אצל מי הכדור"],
  },
  {
    actionId: "UPDATE_VICTOR_OUTCOME", kinds: ["victor-work"], resolve: resolveVictor, read: victorFields,
    plan(args, cur) { if (!(VICTOR_OUTCOMES as readonly string[]).includes(String(args.outcome))) return refuse("BAD_ENUM", "תוצאה לא מוכרת"); return finishPlan(cur, { outcome: String(args.outcome) }); },
    apply: (d, id, a) => d.writeVictorWork(id, { outcome: String(a.outcome) }),
    disclosuresHe: [...COMMON_NO, "ויקטור לא מקבל הודעה; הסטטוס, הפרויקט והמשכורת לא משתנים"],
  },
  {
    actionId: "UPDATE_VICTOR_NOTES", kinds: ["victor-work"], resolve: resolveVictor, read: victorFields,
    plan(args, cur) { const a = notesAfter(args, String(cur.notes ?? ""), "notes"); return isRefusal(a) ? a : finishPlan(cur, { notes: a }); },
    apply: (d, id, a) => d.writeVictorWork(id, { notes: String(a.notes) }),
    disclosuresHe: [...COMMON_NO, "ההערות הפנימיות בלבד — לא הערות גרסה ולא נשלחות לויקטור"],
  },
];
export const PRIMITIVES_BY_ID: ReadonlyMap<string, PrimitiveSpec> = new Map(WAVE1_PRIMITIVES.map((p) => [p.actionId, p]));

// ── executor adapter (engine interface) ─────────────────────────────────────────────────────────────────────────────
/** Fingerprint of exactly the live fields a primitive touches (stale detection). */
export const fieldsFingerprint = (actionId: string, id: string, f: Fields | null) => createHash("sha256").update(canonicalJson({ a: actionId, id, f })).digest("hex");
/** The target id is the step's single resolved entity key. */
export const stepTargetId = (s: PlanStep) => { const k = s.entities[0] ?? ""; return k.slice(k.indexOf(":") + 1); };

export function executorFor(spec: PrimitiveSpec, d: WriterDeps): PrimitiveExecutor {
  return {
    fingerprint: async (s) => fieldsFingerprint(spec.actionId, stepTargetId(s), await spec.read(d, stepTargetId(s))),
    async execute(s) {
      const id = stepTargetId(s);
      const cur = await spec.read(d, id);
      if (!cur) throw new Error("target not found");
      const p = spec.plan(s.args, cur);
      if (!p.ok) {
        if (p.code === "NO_CHANGE_NEEDED") return { changed: false, output: { after: {} } };
        throw new Error(`invalid at execution: ${p.code}`);
      }
      await spec.apply(d, id, p.after);
      return { changed: true, output: { after: p.after } };
    },
    async verify(s, output) {
      const after = ((output as { after?: Fields } | undefined)?.after ?? {}) as Fields;
      const now = await spec.read(d, stepTargetId(s));
      return !!now && Object.entries(after).every(([k, v]) => now[k] === v);
    },
  };
}
