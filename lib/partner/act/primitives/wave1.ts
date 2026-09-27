/**
 * SUNNY UNIVERSAL ACTION LAYER — Wave 1 primitives (internal, reversible, shared UI writers).
 */
import { MAX_TEXT_CHARS } from "../persist";
import type { ArgSpec } from "../types";
import { LABEL_ARTIST_STATUSES, PROJECT_TYPES, RELEASE_STAGES, VICTOR_OUTCOMES, VICTOR_WORK_STATES } from "@/lib/types";
import {
  COMMON_NO, MIX_VERSION_STATUSES, artistFields, commentFields, finishPlan, isRefusal, notesAfter, parseKey, PROJECT_READ, realYmd, refuse, releaseFields,
  resolveComment, resolveProject, resolveRelease, resolveVersion, resolveVictor, text, versionFields, victorFields, type Fields, type PrimitiveMeta, type PrimitiveSpec,
} from "./core";


const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = true): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = true): ArgSpec => ({ name, kind: "enum", required, values });
const MODE = E("mode", ["REPLACE", "APPEND"]);
const M = (domain: string, he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string): PrimitiveMeta =>
  ({ domain, he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview" });
const META: Readonly<Record<string, PrimitiveMeta>> = {
  UPDATE_PROJECT_NOTES: M("PROJECT", "עדכון הערות פרויקט", "Update a project's notes (replace or append)", [K("project"), T("notes"), MODE], ["notes"], "updateProject (lib/projects-store)"),
  UPDATE_PROJECT_PLANNING: M("PROJECT", "עדכון תכנון פרויקט (תאריך התחלה / שעות / ימים)", "Update start date / planned hours / planned days", [K("project"), { name: "startDate", kind: "ymd", required: false }, { name: "plannedHours", kind: "number", required: false }, { name: "plannedDays", kind: "number", required: false }], ["startDate", "plannedHours", "plannedDays"], "updateProject (lib/projects-store)"),
  UPDATE_PROJECT_TYPE_OR_PARENT: M("PROJECT", "שינוי סוג פרויקט / פרויקט אב", "Change project type or parent (name link)", [K("project"), E("projectType", PROJECT_TYPES, false), T("parentProject", false)], ["projectType", "parentProject"], "updateProject (lib/projects-store)"),
  UPDATE_PROJECT_DEADLINE: M("PROJECT", "שינוי דדליין של פרויקט", "Change a project's deadline", [K("project"), { name: "deadline", kind: "ymd", required: true }], ["deadline"], "updateProject (lib/projects-store)"),
  UPDATE_RELEASE_DETAILS: M("LABEL", "עדכון פרטי ריליס (יעד / צעד הבא / חסם / אחראי)", "Update release target / next action / blocker / responsible", [K("project"), { name: "releaseTargetDate", kind: "ymd", required: false }, T("nextAction", false), T("blocker", false), T("responsible", false)], ["releaseTargetDate", "nextAction", "blocker", "responsible"], "updateReleaseDetails (lib/release-store)"),
  CHANGE_RELEASE_STAGE: M("LABEL", "שינוי שלב ריליס", "Change a release stage", [K("project"), E("releaseStage", RELEASE_STAGES)], ["releaseStage"], "updateReleaseDetails (lib/release-store)"),
  RESOLVE_MIX_COMMENT: M("MIX", "סימון הערת מיקס כטופלה", "Resolve a mix comment", [K("mixComment", false), K("mixWork", false), E("which", ["LATEST_OPEN", "LATEST"], false)], ["status"], "updateMixCommentStatus (lib/mix-comments-store)"),
  REOPEN_MIX_COMMENT: M("MIX", "פתיחה מחדש של הערת מיקס", "Reopen a mix comment", [K("mixComment", false), K("mixWork", false), E("which", ["LATEST_RESOLVED", "LATEST"], false)], ["status"], "updateMixCommentStatus (lib/mix-comments-store)"),
  UPDATE_MIX_VERSION_STATUS_OR_LABEL: M("MIX", "עדכון סטטוס / תווית גרסת מיקס", "Update a mix version's status or label (never the file)", [K("mixVersion", false), K("mixWork", false), E("which", ["LATEST"], false), E("status", MIX_VERSION_STATUSES, false), T("versionLabel", false)], ["status", "label"], "updateMixVersion (lib/mix-versions-store)"),
  UPDATE_LABEL_ARTIST_NOTES_STATUS: M("LABEL", "עדכון הערות / סטטוס אמן לייבל", "Update a label artist's notes / status", [K("labelArtist"), T("notes", false), E("mode", ["REPLACE", "APPEND"], false), E("status", LABEL_ARTIST_STATUSES, false)], ["notes", "status"], "updateLabelArtist (lib/label-artists-store)"),
  UPDATE_VICTOR_WORK_STATE: M("VICTOR", "עדכון מצב עבודה של ויקטור", "Update Victor work state", [K("victorWork"), E("workState", VICTOR_WORK_STATES)], ["workState"], "updateVictorWork (lib/vendor-store)"),
  UPDATE_VICTOR_OUTCOME: M("VICTOR", "עדכון תוצאה של עבודת ויקטור", "Update Victor work outcome", [K("victorWork"), E("outcome", VICTOR_OUTCOMES)], ["outcome"], "updateVictorWork (lib/vendor-store)"),
  UPDATE_VICTOR_NOTES: M("VICTOR", "עדכון הערות עבודת ויקטור (בלי שליחה)", "Update Victor work notes (no send)", [K("victorWork"), T("notes"), MODE], ["notes"], "updateVictorWork (lib/vendor-store)"),
};

export const WAVE1_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "UPDATE_PROJECT_NOTES", meta: META.UPDATE_PROJECT_NOTES, kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
    plan(args, cur) { const a = notesAfter(args, String(cur.notes ?? ""), "notes"); return isRefusal(a) ? a : finishPlan(cur, { notes: a }); },
    apply: (d, id, after) => d.writeProject(id, { notes: String(after.notes) }),
    disclosuresHe: [...COMMON_NO, "רק שדה ההערות של הפרויקט משתנה"],
  },
  {
    actionId: "UPDATE_PROJECT_PLANNING", meta: META.UPDATE_PROJECT_PLANNING, kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
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
    actionId: "UPDATE_PROJECT_TYPE_OR_PARENT", meta: META.UPDATE_PROJECT_TYPE_OR_PARENT, kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
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
    actionId: "UPDATE_PROJECT_DEADLINE", meta: META.UPDATE_PROJECT_DEADLINE, kinds: ["project"], resolve: resolveProject, read: PROJECT_READ,
    plan(args, cur) { if (!realYmd(args.deadline)) return refuse("BAD_DATE", "דדליין לא תקין (YYYY-MM-DD)"); return finishPlan(cur, { deadline: args.deadline }); },
    apply: (d, id, a) => d.writeProject(id, { deadline: String(a.deadline) }),
    disclosuresHe: [...COMMON_NO, "רק הדדליין של הפרויקט משתנה (לא דדליינים של ויקטור / סטיבן)"],
  },
  {
    actionId: "UPDATE_RELEASE_DETAILS", meta: META.UPDATE_RELEASE_DETAILS, kinds: ["project", "release"], resolve: resolveRelease, read: releaseFields,
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
    actionId: "CHANGE_RELEASE_STAGE", meta: META.CHANGE_RELEASE_STAGE, kinds: ["project", "release"], resolve: resolveRelease, read: releaseFields,
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
    actionId: "RESOLVE_MIX_COMMENT", meta: META.RESOLVE_MIX_COMMENT, kinds: ["mix-comment", "mix-work"], resolve: resolveComment("resolved"), read: commentFields,
    plan: (_args, cur) => finishPlan(cur, { status: "resolved" }),
    apply: (d, id) => d.writeMixCommentStatus(id, "resolved"),
    disclosuresHe: [...COMMON_NO, "טקסט ההערה לא משתנה; סטיבן לא מקבל הודעה", "סומן כטופל ≠ המיקס אושר"],
  },
  {
    actionId: "REOPEN_MIX_COMMENT", meta: META.REOPEN_MIX_COMMENT, kinds: ["mix-comment", "mix-work"], resolve: resolveComment("open"), read: commentFields,
    plan: (_args, cur) => finishPlan(cur, { status: "open" }),
    apply: (d, id) => d.writeMixCommentStatus(id, "open"),
    disclosuresHe: [...COMMON_NO, "טקסט ההערה לא משתנה; סטיבן לא מקבל הודעה"],
  },
  {
    actionId: "UPDATE_MIX_VERSION_STATUS_OR_LABEL", meta: META.UPDATE_MIX_VERSION_STATUS_OR_LABEL, kinds: ["mix-version", "mix-work"], resolve: resolveVersion, read: versionFields,
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
    actionId: "UPDATE_LABEL_ARTIST_NOTES_STATUS", meta: META.UPDATE_LABEL_ARTIST_NOTES_STATUS, kinds: ["label-artist"],
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
    actionId: "UPDATE_VICTOR_WORK_STATE", meta: META.UPDATE_VICTOR_WORK_STATE, kinds: ["victor-work"], resolve: resolveVictor, read: victorFields,
    plan(args, cur) { if (!(VICTOR_WORK_STATES as readonly string[]).includes(String(args.workState))) return refuse("BAD_ENUM", "מצב עבודה לא מוכר"); return finishPlan(cur, { workState: String(args.workState) }); },
    apply: (d, id, a) => d.writeVictorWork(id, { workState: String(a.workState) }),
    disclosuresHe: [...COMMON_NO, "ויקטור לא מקבל הודעה; הסטטוס (פעיל / הושלם) והדדליין לא משתנים", "מצב העבודה הוא תצוגה בלבד — הוא לא קובע אצל מי הכדור"],
  },
  {
    actionId: "UPDATE_VICTOR_OUTCOME", meta: META.UPDATE_VICTOR_OUTCOME, kinds: ["victor-work"], resolve: resolveVictor, read: victorFields,
    plan(args, cur) { if (!(VICTOR_OUTCOMES as readonly string[]).includes(String(args.outcome))) return refuse("BAD_ENUM", "תוצאה לא מוכרת"); return finishPlan(cur, { outcome: String(args.outcome) }); },
    apply: (d, id, a) => d.writeVictorWork(id, { outcome: String(a.outcome) }),
    disclosuresHe: [...COMMON_NO, "ויקטור לא מקבל הודעה; הסטטוס, הפרויקט והמשכורת לא משתנים"],
  },
  {
    actionId: "UPDATE_VICTOR_NOTES", meta: META.UPDATE_VICTOR_NOTES, kinds: ["victor-work"], resolve: resolveVictor, read: victorFields,
    plan(args, cur) { const a = notesAfter(args, String(cur.notes ?? ""), "notes"); return isRefusal(a) ? a : finishPlan(cur, { notes: a }); },
    apply: (d, id, a) => d.writeVictorWork(id, { notes: String(a.notes) }),
    disclosuresHe: [...COMMON_NO, "ההערות הפנימיות בלבד — לא הערות גרסה ולא נשלחות לויקטור"],
  },
];
