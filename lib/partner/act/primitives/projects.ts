/**
 * SUNNY UNIVERSAL ACTION LAYER — Projects family: status, hide, rename, artist, business type, cover, session limit,
 * create project, create label song, convert to a label release. Every write goes through the SAME shared writer the
 * Redbloods screens use (lib/writes/projects, lib/projects-store, lib/release-store, lib/project-cover-store).
 */
import type { ArgSpec } from "../types";
import { ALL_STATUSES, PROJECT_BUSINESS_TYPES, PROJECT_TYPES, RELEASE_STAGES, isReleasableType } from "@/lib/types";
import { COVER_THEMES } from "@/lib/project-cover";
import { COMMON_NO, finishPlan, parseKey, projectFields, realYmd, refuse, resolveProject, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

/** lib/writes/project-delete ProjectDeleteImpact (the preflight counts — every one is a preview field, so any change is STALE). */
export type ProjectDeleteImpactView = {
  finalFilesBlocking: number;
  sessions: number; calendarEvents: number; sendLog: number; clipRows: number; victorWorks: number; settingsKeys: number; coverCustomImage: number; proposalFollowUpTasks: number;
  engineerWorks: number; mixVersions: number; mixComments: number; mixAttachments: number; albumTracks: number; releaseDetails: number;
  transactionsUnlinked: number; sessionLinkedTransactions: number; proposalsReset: number; socialCampaignsUnlinked: number; finalFilesUnlinked: number;
  /** clip projects linked to this song (song_project_id) — kept; the database sets their link to NULL (2026-09-29) */
  clipProjectsUnlinked?: number;
  tasksKept: number; meetingsKept: number; productionsKept: number; storageFolderKept: number;
};
export interface ProjectFamilyWriters {
  projectDeleteImpact(id: string): Promise<ProjectDeleteImpactView>;
  deleteProjectCompletely(id: string): Promise<unknown>;
  readProjectMeta(id: string): Promise<{ name: string; artist: string; status: string; isHidden: boolean; businessType: string; projectType: string; hasRelease: boolean } | null>;
  writeProjectStatus(id: string, status: string): Promise<void>;
  writeProjectHidden(id: string, hidden: boolean): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  changeProjectArtist(id: string, artist: string): Promise<void>;
  setProjectBusinessType(id: string, businessType: string): Promise<boolean>;
  readProjectCover(id: string): Promise<{ theme: string; customImage: boolean } | null>;
  saveProjectCoverTheme(id: string, theme: string): Promise<void>;
  resetProjectCover(id: string): Promise<void>;
  readSessionLimit(id: string): Promise<number>;
  setSessionLimit(id: string, limit: number): Promise<void>;
  countProjectsNamed(name: string): Promise<number>;
  createClientProject(f: { name: string; artist?: string; status?: string; deadline?: string | null; notes?: string; projectType?: string; parentProject?: string }): Promise<string>;
  /** B2: the business type the shared create writer will store for this artist text (the Owner rule; same function). */
  newProjectBusinessType?(artist: string): Promise<string>;
  createLabelSong(f: { labelArtistId: string; name: string; deadline?: string | null; notes?: string; parentProject?: string; releaseStage?: string; releaseTargetDate?: string | null; nextAction?: string; blocker?: string; responsible?: string }): Promise<string>;
  convertToLabelRelease(projectId: string, labelArtistId: string, input: { releaseStage?: string; releaseTargetDate?: string | null; nextAction?: string; blocker?: string; responsible?: string }): Promise<string>;
}

const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = true): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = true): ArgSpec => ({ name, kind: "enum", required, values });
const D = (name: string, required = false): ArgSpec => ({ name, kind: "ymd", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta> = {}): PrimitiveMeta =>
  ({ domain: "PROJECT", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const THEMES: readonly string[] = COVER_THEMES.map((t) => t.id);

async function metaFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const p = await d.readProjectMeta(id);
  return p ? { name: p.name, artist: p.artist, status: p.status, isHidden: p.isHidden, businessType: p.businessType, projectType: p.projectType, hasRelease: p.hasRelease } : null;
}
async function resolveProjectMeta(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(args.project, ["project"]);
  if (!k) return refuse("BAD_ENTITY", "צריך מפתח פרויקט תקין (project:…)");
  const f = await metaFields(d, k.id);
  return f ? { key: `project:${k.id}`, id: k.id, label: String(f.name), fields: f } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
}
const onProject = (read: (d: WriterDeps, id: string) => Promise<Fields | null>) => async (d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> => {
  const k = parseKey(args.project, ["project"]);
  if (!k) return refuse("BAD_ENTITY", "צריך מפתח פרויקט תקין (project:…)");
  const [f, m] = await Promise.all([read(d, k.id), d.readProjectMeta(k.id)]);
  return f && m ? { key: `project:${k.id}`, id: k.id, label: m.name, fields: f } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
};
const coverFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const m = await d.readProjectMeta(id); if (!m) return null; const c = await d.readProjectCover(id); return { theme: c?.theme ?? "redbloods", customImage: c?.customImage ?? false, hasCover: !!c }; };
/** B2: the preview shows the type the shared writer will store (the same Owner rule function behind both paths). */
async function createBusinessType(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<Fields> {
  const artist = typeof args.artist === "string" ? args.artist.trim() : "";
  return { newBusinessType: d.newProjectBusinessType ? await d.newProjectBusinessType(artist) : "לקוח" };
}
const limitFields = async (d: WriterDeps, id: string): Promise<Fields | null> => (await d.readProjectMeta(id)) ? { sessionLimit: await d.readSessionLimit(id) } : null;

export const PROJECT_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "DELETE_PROJECT", kinds: ["project"],
    meta: meta("מחיקת פרויקט (עם כל מה שהוא מחזיק)", "Delete a project the way the app does — READ-ONLY preflight first (refused with BLOCKED_BY_DEPENDENTS while final files sit on its mix works, zero writes); then sessions, send log, clip rows, Victor works (+ tasks), every per-project settings key; transactions unlinked, proposals back to 'לא נסגר', alerts closed; a fresh blocker re-check; the project row (the database cascades release details, album tracks, engineer works + versions / comments / attachments); Google Calendar events / Google Tasks / the cover file only AFTER the database commit, reported", [K("project")], ["exists"], "deleteProjectCompletely (lib/writes/project-delete, projectDeletePreflight first)", { effects: ["DELETION", "CASCADE", "UNLINK", "CALENDAR", "GOOGLE_TASKS", "FINANCE", "FILES"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) {
      const r = await resolveProjectMeta(d, a); if ("ok" in r) return r;
      const c = await d.projectDeleteImpact(r.id);
      if (c.finalFilesBlocking > 0) return refuse("BLOCKED_BY_DEPENDENTS", `אי אפשר למחוק את הפרויקט: יש ${c.finalFilesBlocking} קבצים סופיים (Final Files) על עבודות המיקס שלו — מסד הנתונים לא מאפשר למחוק עבודה עם קבצים סופיים. קודם מוחקים את הקבצים הסופיים, ואז מתכננים מחדש`);
      return { ...r, fields: { name: r.fields.name, exists: true, ...c } };
    },
    async read(d, id) { const m = await d.readProjectMeta(id); return m ? { name: m.name, exists: true, ...(await d.projectDeleteImpact(id)) } : null; },
    plan: (_a, cur) => (Number(cur.finalFilesBlocking) > 0 ? refuse("BLOCKED_BY_DEPENDENTS", `יש ${cur.finalFilesBlocking} קבצים סופיים על עבודות המיקס של הפרויקט — קודם מוחקים אותם`) : { ok: true, after: { exists: false } }),
    async apply(d, id) { await d.deleteProjectCompletely(id); },
    async verify(d, id) { return (await d.readProjectMeta(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [
      `נמחקים: ${c.sessions} סשנים (${c.calendarEvents} אירועי יומן), ${c.sendLog} רשומות שליחה, ${c.clipRows} שורות קליפ, ${c.victorWorks} עבודות ויקטור (+ המשימות שלהן), ${c.settingsKeys} הגדרות פרויקט${Number(c.coverCustomImage) > 0 ? ", קובץ תמונת הנושא" : ""}, ${c.proposalFollowUpTasks} משימות מעקב של הצעות`,
      `נמחקים עם הפרויקט (מסד הנתונים): ${c.engineerWorks} עבודות מיקס (${c.mixVersions} גרסאות, ${c.mixComments} הערות, ${c.mixAttachments} צרופות — הקבצים עצמם נשארים באחסון), ${c.albumTracks} שירי אלבום, ${c.releaseDetails} רשומות ריליס`,
      `מתנתקים (לא נמחקים): ${c.transactionsUnlinked} רשומות כספים; ${c.sessionLinkedTransactions} רשומות כספים מקושרות לסשנים שנמחקים (הקישור לסשן לא יצביע על כלום); ${c.proposalsReset} הצעות חוזרות ל'לא נסגר'; ${c.socialCampaignsUnlinked} קמפייני סושיאל; ${c.finalFilesUnlinked} קבצים סופיים שמקושרים רק לפרויקט${Number(c.clipProjectsUnlinked ?? 0) > 0 ? `; ${c.clipProjectsUnlinked} פרויקטי קליפ שמקושרים לשיר הזה — הם נשארים, אבל הקישור שלהם לשיר נמחק` : ""}`,
      `נשארים כמו שהם: ${c.tasksKept} משימות, ${c.meetingsKept} פגישות, ${c.productionsKept} הפקות Red Films${Number(c.storageFolderKept) > 0 ? ", תיקיית הפרויקט באחסון" : ""}`,
    ],
    disclosuresHe: ["בדיקה מקדימה לפני כל כתיבה: קבצים סופיים על עבודות המיקס חוסמים את המחיקה (בלי שום שינוי)", "כל שלב נבדק; כשל עוצר לפני מחיקת הפרויקט עצמו (אפשר לנסות שוב); בדיקת חסימה נוספת רגע לפני מחיקת השורה", "אירועי יומן, Google Tasks וקובץ תמונת הנושא נמחקים רק אחרי שהמחיקה במסד הנתונים הצליחה — וכשל שם מדווח", "לא טרנזקציה אחת במסד הנתונים (דורש פונקציית SQL מאושרת)", "לקוחות לא נמחקים לעולם", "לא נשלח Push / מייל"],
  },
  {
    actionId: "CLEAR_PROJECT_DEADLINE", kinds: ["project"],
    meta: meta("הסרת הדדליין של פרויקט", "Clear a project's deadline (the UI's empty date) — the overdue / due-soon reminders stop for it, exactly as in the app", [K("project")], ["deadline"], "updateProject (lib/projects-store)"),
    resolve: resolveProject, read: projectFields,
    plan: (_a, cur) => (cur.deadline ? finishPlan(cur, { deadline: null }) : refuse("NO_CHANGE_NEEDED", "לפרויקט אין דדליין")),
    apply: (d, id) => d.writeProject(id, { deadline: null }),
    disclosuresHe: [...COMMON_NO, "תזכורות 'באיחור / מתקרב' של המערכת מפסיקות לפרויקט הזה (הן נגזרות מהדדליין)"],
  },
  {
    actionId: "UPDATE_PROJECT_STATUS", kinds: ["project"],
    meta: meta("שינוי סטטוס פרויקט", "Change a project's status (the app's end-date rule applies)", [K("project"), E("status", ALL_STATUSES)], ["status"], "updateProject + statusPatch (lib/writes/projects)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: resolveProjectMeta, read: metaFields,
    plan(args, cur) { if (!(ALL_STATUSES as readonly string[]).includes(String(args.status))) return refuse("BAD_ENUM", "סטטוס פרויקט לא מוכר"); return finishPlan(cur, { status: String(args.status) }); },
    apply: (d, id, a) => d.writeProjectStatus(id, String(a.status)),
    disclosuresHe: [...COMMON_NO, "'הושלם' רושם תאריך סיום היום; כל סטטוס אחר מוחק אותו (כמו באפליקציה)", "עבודת ויקטור, הכנסות פתוחות ומסירה לא משתנים — אלה פעולות נפרדות שאפשר לבקש"],
  },
  {
    actionId: "SET_PROJECT_HIDDEN", kinds: ["project"],
    meta: meta("הסתרה / החזרה של פרויקט", "Hide or unhide a project", [K("project"), { name: "hidden", kind: "boolean", required: true }], ["isHidden"], "updateProject (lib/projects-store)"),
    resolve: resolveProjectMeta, read: metaFields,
    plan(args, cur) { if (typeof args.hidden !== "boolean") return refuse("BAD_BOOLEAN", "להסתיר או להחזיר?"); return finishPlan(cur, { isHidden: args.hidden }); },
    apply: (d, id, a) => d.writeProjectHidden(id, a.isHidden === true),
    disclosuresHe: [...COMMON_NO, "הפרויקט לא נמחק — רק מוסתר מהתצוגה הפעילה"],
  },
  {
    actionId: "RENAME_PROJECT", kinds: ["project"],
    meta: meta("שינוי שם פרויקט", "Rename a project (its storage folder is frozen, never moved)", [K("project"), T("name")], ["name"], "renameProject (lib/writes/projects)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: resolveProjectMeta, read: metaFields,
    plan(args, cur) { const n = text(args.name, 200); if (n === null) return refuse("BAD_TEXT", "שם חדש חסר"); return finishPlan(cur, { name: n.trim() }); },
    apply: (d, id, a) => d.renameProject(id, String(a.name)),
    disclosuresHe: [...COMMON_NO, "תיקיית הקבצים של הפרויקט לא זזה (היא 'מוקפאת' לשם הקודם, כמו באפליקציה)"],
  },
  {
    actionId: "CHANGE_PROJECT_ARTIST", kinds: ["project"],
    meta: meta("שינוי אמן בפרויקט", "Change a project's artist text (missing artists are added as clients)", [K("project"), T("artist")], ["artist"], "changeProjectArtist (lib/writes/projects)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL" }),
    resolve: resolveProjectMeta, read: metaFields,
    plan(args, cur) { const a = text(args.artist, 200); if (a === null) return refuse("BAD_TEXT", "שם אמן חסר"); return finishPlan(cur, { artist: a.trim() }); },
    apply: (d, id, a) => d.changeProjectArtist(id, String(a.artist)),
    disclosuresHe: ["אמן שלא קיים עדיין כלקוח יתווסף ללקוחות (כמו באפליקציה); לקוחות לא נמחקים", "לא יישלח Push או הודעה", "הקישור ללקוח הוא לפי שם בלבד"],
  },
  {
    actionId: "SET_PROJECT_BUSINESS_TYPE", kinds: ["project"],
    meta: meta("סיווג פרויקט: לקוח / לייבל", "Switch a project between client work and label", [K("project"), E("businessType", PROJECT_BUSINESS_TYPES)], ["businessType"], "setProjectBusinessType (lib/release-store)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: resolveProjectMeta, read: metaFields,
    plan(args, cur) { if (!(PROJECT_BUSINESS_TYPES as readonly string[]).includes(String(args.businessType))) return refuse("BAD_ENUM", "לקוח או לייבל?"); return finishPlan(cur, { businessType: String(args.businessType) }); },
    async apply(d, id, a) { if (!(await d.setProjectBusinessType(id, String(a.businessType)))) throw new Error("project not found"); },
    disclosuresHe: [...COMMON_NO, "רשומת ריליס קיימת נשמרת (רדומה) — לא נמחקת"],
  },
  {
    actionId: "SET_PROJECT_COVER_THEME", kinds: ["project"],
    meta: meta("עיצוב תמונת נושא לפרויקט", "Set a project's cover theme", [K("project"), E("theme", THEMES)], ["theme"], "saveThemeCover (lib/project-cover-store)"),
    resolve: onProject(coverFields), read: coverFields,
    plan(args, cur) { if (!THEMES.includes(String(args.theme))) return refuse("BAD_ENUM", "סגנון לא מוכר"); return finishPlan(cur, { theme: String(args.theme) }); },
    apply: (d, id, a) => d.saveProjectCoverTheme(id, String(a.theme)),
    disclosuresHe: [...COMMON_NO, "תמונה מותאמת שהועלתה (אם יש) נשארת כפי שהיא"],
  },
  {
    actionId: "RESET_PROJECT_COVER", kinds: ["project"],
    meta: meta("איפוס תמונת נושא לברירת מחדל", "Reset a project's cover to the default (removes a custom image)", [K("project")], ["hasCover"], "resetProjectCover (lib/project-cover-store)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "PARTIAL", compensation: null }),
    resolve: onProject(coverFields), read: coverFields,
    plan: (_args, cur) => (cur.hasCover ? { ok: true, after: { hasCover: false } } : refuse("NO_CHANGE_NEEDED", "הפרויקט כבר בברירת המחדל")),
    apply: (d, id) => d.resetProjectCover(id),
    requiredValues: () => ["איפוס"],
    disclosuresHe: ["אם הועלתה תמונה מותאמת — הקובץ שלה נמחק מהאחסון", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_SESSION_LIMIT", kinds: ["project"],
    meta: meta("מכסת סשנים לפרויקט", "Set a project's session limit", [K("project"), { name: "limit", kind: "number", required: true }], ["sessionLimit"], "setSessionLimit (lib/writes/projects)", { effects: ["SETTINGS"] }),
    resolve: onProject(limitFields), read: limitFields,
    plan(args, cur) { const n = args.limit; if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 500) return refuse("BAD_NUMBER", "מכסה חייבת להיות מספר שלם לא שלילי"); return finishPlan(cur, { sessionLimit: n }); },
    apply: (d, id, a) => d.setSessionLimit(id, Number(a.sessionLimit)),
    disclosuresHe: [...COMMON_NO, "רק המכסה משתנה — סשנים קיימים לא משתנים"],
  },
  {
    actionId: "CREATE_PROJECT", warnings: (c) => (Number(c.sameNameProjects) > 0 ? [`כבר קיים פרויקט באותו שם (${c.sameNameProjects}) — לוודא שזה לא כפול`] : []), kinds: ["project"],
    meta: meta("יצירת פרויקט (לקוח, או לייבל לפי כלל הבעלים)", "Create a project — business type by the Owner rule (שליו טסמה / אבי מולה credited → לייבל, else לקוח), shown in the preview", [T("name"), T("artist", false), E("projectType", PROJECT_TYPES, false), D("deadline"), T("notes", false), E("status", ALL_STATUSES, false), T("parentProject", false)], ["name", "artist", "projectType", "deadline", "status", "businessType"], "createClientProject (lib/writes/projects)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the new project (a separate approved destructive action)" }),
    async createContext(d, args) { return { sameNameProjects: typeof args.name === "string" ? await d.countProjectsNamed(args.name.trim()) : 0, ...(await createBusinessType(d, args)) }; },
    async resolve(d, args) {
      const n = text(args.name, 200); if (n === null) return refuse("BAD_TEXT", "שם הפרויקט חסר");
      return { key: "project:new", id: "new", label: n.trim(), fields: { sameNameProjects: await d.countProjectsNamed(n.trim()), ...(await createBusinessType(d, args)) } };
    },
    read: metaFields,
    plan(args, cur) {
      const n = text(args.name, 200); if (n === null) return refuse("BAD_TEXT", "שם הפרויקט חסר");
      if (args.deadline !== undefined && !realYmd(args.deadline)) return refuse("BAD_DATE", "דדליין לא תקין");
      if (args.projectType !== undefined && !(PROJECT_TYPES as readonly string[]).includes(String(args.projectType))) return refuse("BAD_ENUM", "סוג פרויקט לא מוכר");
      if (args.status !== undefined && !(ALL_STATUSES as readonly string[]).includes(String(args.status))) return refuse("BAD_ENUM", "סטטוס לא מוכר");
      return { ok: true, after: { name: n.trim(), artist: typeof args.artist === "string" ? args.artist.trim() : "", projectType: args.projectType !== undefined ? String(args.projectType) : "", deadline: (args.deadline as string | undefined) ?? null, status: args.status !== undefined ? String(args.status) : "לא התחיל", businessType: String(cur.newBusinessType ?? "לקוח") } };
    },
    async apply(d, _id, a, args) { return { createdId: await d.createClientProject({ name: String(a.name), artist: String(a.artist ?? ""), status: String(a.status), deadline: (a.deadline as string | null) ?? null, notes: typeof args.notes === "string" ? args.notes : "", projectType: String(a.projectType ?? ""), parentProject: typeof args.parentProject === "string" ? args.parentProject : "" }) }; },
    async verify(d, id, after) { const p = await d.readProjectMeta(id); return !!p && p.name === after.name && p.status === after.status && p.businessType === String(after.businessType ?? "לקוח"); },
    disclosuresHe: ["נוצר פרויקט חדש עם תאריך התחלה היום; הסוג (לקוח / לייבל) לפי כלל הבעלים — שליו טסמה או אבי מולה בקרדיט (לבד או בשיתוף) → לייבל, אחרת לקוח; הסוג מוצג בתצוגה המקדימה", "אמן שלא קיים כלקוח יתווסף ללקוחות", "לא יישלח Push או הודעה; לא נוצרת תיקייה, אירוע יומן או רשומה כספית"],
  },
  {
    actionId: "CREATE_LABEL_SONG", warnings: (c) => (Number(c.sameNameProjects) > 0 ? [`כבר קיים פרויקט באותו שם (${c.sameNameProjects}) — לוודא שזה לא כפול`] : []), kinds: ["label-artist"],
    meta: { ...meta("יצירת שיר לייבל (פרויקט + ריליס)", "Create a label song (project + release, atomic)", [K("labelArtist"), T("name"), D("deadline"), T("notes", false), T("parentProject", false), E("releaseStage", RELEASE_STAGES, false), D("releaseTargetDate"), T("nextAction", false), T("blocker", false), T("responsible", false)], ["name", "labelArtistId", "releaseStage"], "createLabelSongRelease (lib/release-store, atomic DB function)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the new project (a separate approved destructive action)" }), domain: "LABEL" },
    async createContext(d, args) { const k = parseKey(args.labelArtist, ["label-artist"]); return { artistExists: !!(k && (await d.readLabelArtist(k.id))), sameNameProjects: typeof args.name === "string" ? await d.countProjectsNamed(args.name.trim()) : 0 }; },
    async resolve(d, args) {
      const k = parseKey(args.labelArtist, ["label-artist"]); if (!k) return refuse("BAD_ENTITY", "צריך אמן לייבל (label-artist:…)");
      const a = await d.readLabelArtist(k.id); if (!a) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את אמן הלייבל");
      const n = text(args.name, 200); if (n === null) return refuse("BAD_TEXT", "שם השיר חסר");
      return { key: "project:new", id: "new", label: `${n.trim()} — ${a.name}`, fields: { artistExists: true, sameNameProjects: await d.countProjectsNamed(n.trim()) } };
    },
    read: metaFields,
    plan(args, cur) {
      if (!cur.artistExists) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את אמן הלייבל");
      const n = text(args.name, 200); if (n === null) return refuse("BAD_TEXT", "שם השיר חסר");
      if (args.releaseStage !== undefined && !(RELEASE_STAGES as readonly string[]).includes(String(args.releaseStage))) return refuse("BAD_ENUM", "שלב ריליס לא מוכר");
      for (const k of ["deadline", "releaseTargetDate"]) if (args[k] !== undefined && !realYmd(args[k])) return refuse("BAD_DATE", "תאריך לא תקין");
      const k = parseKey(args.labelArtist, ["label-artist"])!;
      return { ok: true, after: { name: n.trim(), labelArtistId: k.id, releaseStage: args.releaseStage !== undefined ? String(args.releaseStage) : "רעיון" } };
    },
    async apply(d, _id, a, args) {
      const s = (k: string) => (typeof args[k] === "string" ? String(args[k]) : undefined);
      return { createdId: await d.createLabelSong({ labelArtistId: String(a.labelArtistId), name: String(a.name), deadline: s("deadline") ?? null, notes: s("notes") ?? "", parentProject: s("parentProject") ?? "", releaseStage: String(a.releaseStage), releaseTargetDate: s("releaseTargetDate") ?? null, nextAction: s("nextAction"), blocker: s("blocker"), responsible: s("responsible") }) };
    },
    async verify(d, id, after) { const p = await d.readProjectMeta(id); return !!p && p.name === after.name && p.businessType === "לייבל" && p.hasRelease; },
    disclosuresHe: ["נוצרים יחד (אטומי): פרויקט לייבל + רשומת ריליס לאמן", "לא יישלח Push או הודעה; לא נוצרת רשומה כספית"],
  },
  {
    actionId: "CONVERT_TO_LABEL_RELEASE", kinds: ["project"],
    meta: { ...meta("הפיכת פרויקט לריליס של הלייבל", "Mark an existing project as a label release", [K("project"), K("labelArtist"), E("releaseStage", RELEASE_STAGES, false), D("releaseTargetDate"), T("nextAction", false), T("blocker", false), T("responsible", false)], ["hasRelease"], "convertProjectToLabelRelease (lib/release-store)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: null }), domain: "LABEL" },
    resolve: resolveProjectMeta, read: metaFields,
    plan(args, cur) {
      if (cur.hasRelease) return refuse("NO_CHANGE_NEEDED", "לפרויקט כבר יש רשומת ריליס");
      if (!parseKey(args.labelArtist, ["label-artist"])) return refuse("BAD_ENTITY", "צריך אמן לייבל (label-artist:…)");
      if (args.releaseStage !== undefined && !(RELEASE_STAGES as readonly string[]).includes(String(args.releaseStage))) return refuse("BAD_ENUM", "שלב ריליס לא מוכר");
      if (args.releaseTargetDate !== undefined && !realYmd(args.releaseTargetDate)) return refuse("BAD_DATE", "תאריך יעד לא תקין");
      if (!isReleasableType(String(cur.projectType))) return refuse("NOT_RELEASABLE", "סוג הפרויקט לא מתאים לריליס (שיר, EP, אלבום או רידים)");
      return { ok: true, after: { hasRelease: true } };
    },
    async apply(d, id, _a, args) {
      const s = (k: string) => (typeof args[k] === "string" ? String(args[k]) : undefined);
      const r = await d.convertToLabelRelease(id, parseKey(args.labelArtist, ["label-artist"])!.id, { releaseStage: s("releaseStage"), releaseTargetDate: s("releaseTargetDate") ?? null, nextAction: s("nextAction"), blocker: s("blocker"), responsible: s("responsible") });
      if (r !== "ok") throw new Error(`convert refused: ${r}`);
    },
    disclosuresHe: ["נוצרת רשומת ריליס לפרויקט (האמן חייב להופיע בקרדיטים של הפרויקט — כמו באפליקציה)", "לא יישלח Push או הודעה; לא נוצרת רשומה כספית"],
  },
];
