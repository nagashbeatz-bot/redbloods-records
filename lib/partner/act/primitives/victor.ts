/**
 * SUNNY UNIVERSAL ACTION LAYER — Victor (external producer) family: works, status, deadline, title / brief text, the
 * two Owner send buttons, per-version review drafts, removal, settings, salary month rows and overrides. Every write
 * goes through lib/vendor-store + lib/writes/victor — the writers the Victor screens use. Victor-role security stays in
 * the routes and lib/victor-scope; Sunny acts only as the Owner.
 *
 * App rules only: a salary month is paid only when its finance row is שולם (mark it through the Finance status
 * primitive); overrides and legacy monthly marks are Owner statements, never payment facts; $ and ₪ never add; the
 * monthly goal is a KPI, never a pay rule. The ball / handoff rule stays the app's computeVictorBall (read side).
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { VICTOR_PAYMENT_STATUSES, VICTOR_SALARY_CURRENCIES, validateVictorSettingsPatch } from "@/lib/victor-settings-input";
import { VICTOR_WORK_STATES } from "@/lib/types";

export type VictorWorkView = { title: string; projectId: string | null; projectName: string; status: string; workState: string | null; sentDate: string | null; internalDeadline: string | null; briefText: string; hasTask: boolean; reviewKeys: string; vendorName: string };
type Send = { ok: boolean; reason?: string };
export interface VictorFamilyWriters {
  victorFolderState(workId: string): Promise<{ hasFolder: boolean } | null>;
  setUpVictorFolder(workId: string): Promise<void>;
  victorWorkFiles(workId: string): Promise<Array<{ ref: string; name: string; uploadedBy: string | null }> | null>;
  deleteVictorWorkFile(workId: string, fileRef: string): Promise<string>;
  readVictorWorkFull(id: string): Promise<VictorWorkView | null>;
  victorWorkForProject(projectId: string): Promise<string | null>;
  createVictorWorkRecord(projectId: string | null, f: { title: string | null; workState: string | null; sentDate: string; notes: string }): Promise<string>;
  ownerPatchVictorWork(id: string, body: Record<string, unknown>): Promise<void>;
  removeVictorWork(id: string): Promise<{ removedTask: boolean }>;
  notifyVictorWork(id: string): Promise<Send>;
  readVictorReview(id: string, versionKey: string): Promise<{ notes: string; draft: boolean; sent: boolean } | null>;
  saveVictorReviewDraft(id: string, versionKey: string, notes: string): Promise<"ok" | "not_found" | "conflict">;
  sendVictorVersionNotes(id: string, versionKey: string): Promise<Send>;
  readVictorSettings(): Promise<{ monthlyGoal: number; monthlySalary: number; salaryCurrency: string; salaryPayDay: number; stuckAfterDays: number }>;
  updateVictorSettings(patch: Record<string, unknown>): Promise<void>;
  readVictorSalaryMonth(workMonth: string): Promise<{ row: { id: string; status: string; amount: number; currency: string } | null; amountOverride: number | null; statusOverride: string | null; legacyMark: string | null }>;
  recordVictorSalaryMonth(p: { workMonth: string; amount: number; currency: string; historicPaid: boolean; paidDate?: string }): Promise<"ok" | "duplicate" | "error">;
  setVictorSalaryOverride(workMonth: string, p: { amount?: number; status?: string }): Promise<void>;
  setVictorLegacyPaymentMark(month: string, status: string, paidDate?: string): Promise<void>;
}

export const VICTOR_STATUS_VALUES: readonly string[] = ["פעיל", "הושלם", "בוטל"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (n: number, c: string) => `${c}${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "VICTOR", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });

const vFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const w = await d.readVictorWorkFull(id); return w ? { ...w } : null; };
async function onVictor(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודה של ויקטור (victor-work:…)");
  const f = await vFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את העבודה");
  if (f.vendorName !== "victor") return refuse("WRONG_ENTITY_TYPE", "זו לא עבודה של ויקטור");
  return { key: `victor-work:${k.id}`, id: k.id, label: String(f.title || f.projectName), fields: f };
}
const monthFields = async (d: WriterDeps, m: string): Promise<Fields> => { const r = await d.readVictorSalaryMonth(m); return { rowStatus: r.row?.status ?? null, rowAmount: r.row?.amount ?? null, rowCurrency: r.row?.currency ?? null, amountOverride: r.amountOverride, statusOverride: r.statusOverride, legacyMark: r.legacyMark }; };
async function onMonth(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  if (!MONTH.test(String(a.workMonth))) return refuse("BAD_MONTH", "חודש עבודה בפורמט YYYY-MM");
  return { key: `victor-month:${a.workMonth}`, id: String(a.workMonth), label: `משכורת ויקטור ${a.workMonth}`, fields: await monthFields(d, String(a.workMonth)) };
}

const VFREF = /^[A-Za-z0-9_-]{8,64}$/;
async function onVictorFile(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת ויקטור (victor-work:…)");
  const files = await d.victorWorkFiles(k.id); if (!files) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת ויקטור");
  const choices = () => (files.length ? ` — קבצי העבודה (fileRef — שם): ${files.slice(0, 40).map((f) => `${f.ref} — ${f.name.slice(0, 60)}${f.uploadedBy ? ` (${f.uploadedBy})` : ""}`).join("; ")}` : " — אין קבצים בעבודה");
  if (typeof a.fileRef !== "string" || !VFREF.test(a.fileRef)) return refuse("BAD_ENTITY", `fileRef לא תקין${choices()}`);
  const f = files.find((x) => x.ref === a.fileRef); if (!f) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את הקובץ בעבודה${choices()}`);
  return { key: `victor-asset:${k.id}.${f.ref}`, id: `${k.id}.${f.ref}`, label: f.name, fields: { fileName: f.name, uploadedBy: f.uploadedBy, exists: true } };
}
const vSplit = (id: string) => { const i = id.indexOf("."); return { workId: id.slice(0, i), ref: id.slice(i + 1) }; };
async function victorFileRead(d: WriterDeps, id: string): Promise<Fields | null> { const { workId, ref } = vSplit(id); const f = ((await d.victorWorkFiles(workId)) ?? []).find((x) => x.ref === ref); return f ? { fileName: f.name, uploadedBy: f.uploadedBy, exists: true } : null; }

export const VICTOR_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "SET_UP_VICTOR_FOLDER", kinds: ["victor-work"],
    meta: meta("הקמת תיקיית העבודה של ויקטור (עם קישור ציבורי)", "Set up the Victor work's folder tree (01_From_Redbloods / 02_From_Victor / 03_Approved / Production, under the project's folder) with a PUBLIC link, stored on the work — names are read server-side", [K("victorWork")], ["hasFolder"], "setUpVictorFolderForWork (lib/writes/victor)", { effects: ["FILES", "EXTERNAL_LINK"], riskClass: "FILE_MUTATION", reversible: "PARTIAL", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת ויקטור (victor-work:…)"); const s = await d.victorFolderState(k.id); if (!s) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת ויקטור"); return { key: `victor-work:${k.id}`, id: k.id, label: "תיקיית ויקטור", fields: { hasFolder: s.hasFolder } }; },
    read: async (d, id) => { const s = await d.victorFolderState(id); return s ? { hasFolder: s.hasFolder } : null; },
    plan: (_a, cur) => (cur.hasFolder ? refuse("ALREADY_EXISTS", "לעבודה כבר יש תיקייה") : { ok: true, after: { hasFolder: true } }),
    apply: (d, id) => d.setUpVictorFolder(id),
    requiredValues: () => ["קישור ציבורי"],
    disclosuresHe: ["נוצרות תיקיות באחסון ונוצר קישור ציבורי לתיקייה (נשמר בעבודה, לא מוצג לסאני)", "לא נשלח כלום לויקטור"],
  },
  {
    actionId: "DELETE_VICTOR_FILE", kinds: ["victor-asset"],
    meta: meta("מחיקת קובץ מעבודת ויקטור", "Delete one file of a Victor work (storage first, then only that entry; the version's review goes when it was that version's last file) — the Owner's delete in the Victor screen", [K("victorWork"), T("fileRef", true)], ["exists"], "deleteVictorWorkFileByRef (lib/writes/victor)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onVictorFile, read: victorFileRead,
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const { workId, ref } = vSplit(id); const r = await d.deleteVictorWorkFile(workId, ref); if (r !== "ok") throw new Error(`victor file delete: ${r}`); },
    async verify(d, id) { return (await victorFileRead(d, id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`"${c.fileName}" נמחק מהאחסון לצמיתות${c.uploadedBy === "victor" ? " (קובץ שויקטור העלה)" : ""}`],
    disclosuresHe: ["רק קובץ ששייך לעבודה הזאת (לפי מזהה, לא נתיב)", "ויקטור לא מקבל Push"],
  },
  {
    actionId: "CREATE_VICTOR_WORK", kinds: ["victor-work"],
    meta: meta("פתיחת עבודה לויקטור (לפרויקט או עצמאית)", "Create a Victor work, project-linked or standalone (nothing is sent to Victor — that is a separate push)", [K("project", false), T("title"), { name: "workState", kind: "enum", required: false, values: VICTOR_WORK_STATES as readonly string[] }, { name: "sentDate", kind: "ymd", required: false }, T("notes")], ["title", "workState", "sentDate"], "createVictorWork (lib/vendor-store)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "remove the work (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.project, ["project"]); return { existing: k ? await d.victorWorkForProject(k.id) : null, projectName: k ? (await d.readProjectMeta(k.id))?.name ?? null : null }; },
    async resolve(d, a) {
      const k = parseKey(a.project, ["project"]);
      if (a.project !== undefined && !k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
      const pm = k ? await d.readProjectMeta(k.id) : null;
      if (k && !pm) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
      return { key: "victor-work:new", id: "new", label: String(a.title ?? pm?.name ?? ""), fields: { existing: k ? await d.victorWorkForProject(k.id) : null, projectName: pm?.name ?? null } };
    },
    read: vFields,
    plan(a, cur) {
      if (cur.existing) return refuse("DUPLICATE", "לפרויקט הזה כבר יש עבודה של ויקטור");
      if (a.project === undefined && text(a.title, 200) === null) return refuse("MISSING_TARGET", "צריך פרויקט או שם עבודה");
      if (a.sentDate !== undefined && !realYmd(a.sentDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      const ws = a.workState !== undefined ? String(a.workState) : a.project !== undefined ? "נשלח לויקטור" : null;
      return { ok: true, after: { title: str(a.title)?.trim() ?? null, workState: ws, sentDate: str(a.sentDate) ?? new Date().toISOString().slice(0, 10) } };
    },
    async apply(d, _id, after, a) { return { createdId: await d.createVictorWorkRecord(parseKey(a.project, ["project"])?.id ?? null, { title: (after.title as string | null) ?? null, workState: (after.workState as string | null) ?? null, sentDate: String(after.sentDate), notes: str(a.notes) ?? "" }) }; },
    async verify(d, id, after) { const w = await d.readVictorWorkFull(id); return !!w && w.sentDate === after.sentDate && w.vendorName === "victor"; },
    disclosuresHe: ["נפתחת עבודה בסטטוס פעיל; שום דבר לא נשלח לויקטור (Push הוא פעולה נפרדת, וצריך לו שם עבודה לויקטור)", "תיקייה / קישור ב-Dropbox לא נוצרים כאן"],
  },
  {
    actionId: "UPDATE_VICTOR_WORK_DETAILS", kinds: ["victor-work"],
    meta: meta("עדכון עבודת ויקטור (שם לויקטור / תאריך שליחה / טקסט הבריף)", "Update a Victor work's Victor-facing title, sent date or brief text", [K("victorWork"), T("title"), { name: "sentDate", kind: "ymd", required: false }, T("briefText")], ["title", "sentDate", "briefText"], "updateVictorWork (lib/writes/victor)", {}),
    resolve: onVictor, read: vFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.title !== undefined) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "שם לא תקין"); after.title = t.trim(); }
      if (a.sentDate !== undefined) { if (!realYmd(a.sentDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.sentDate = String(a.sentDate); }
      if (a.briefText !== undefined) { const t = text(a.briefText); if (t === null) return refuse("BAD_TEXT", "טקסט בריף לא תקין"); after.briefText = t; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.ownerPatchVictorWork(id, { ...a }),
    disclosuresHe: ["ויקטור רואה את השם ואת הבריף בפורטל שלו (בלי Push)", "שם הפרויקט עצמו לא משתנה"],
  },
  {
    actionId: "SET_VICTOR_WORK_STATUS", kinds: ["victor-work"],
    meta: meta("סטטוס עבודת ויקטור (פעיל / הושלם / בוטל)", "Set a Victor work's status (→ הושלם sets the completion date and sends the app's completed push)", [K("victorWork"), { name: "status", kind: "enum", required: true, values: VICTOR_STATUS_VALUES }], ["status"], "updateVictorWork + completed notify (lib/writes/victor)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "PARTIAL" }),
    resolve: onVictor, read: vFields,
    plan: (a, cur) => (VICTOR_STATUS_VALUES.includes(String(a.status)) ? finishPlan(cur, { status: String(a.status) }) : refuse("BAD_ENUM", "פעיל / הושלם / בוטל")),
    apply: (d, id, a) => d.ownerPatchVictorWork(id, { status: a.status }),
    requiredValues: (_a, after) => [String(after.status)],
    disclosuresHe: ["'הושלם' קובע תאריך השלמה ושולח את ה-Push של האפליקציה על עבודה שהושלמה (פעם אחת); סטטוס אחר מנקה את התאריך", "משכורת לא משתנה — היא לפי חודש, לא לפי עבודה"],
  },
  {
    actionId: "SET_VICTOR_DEADLINE", kinds: ["victor-work"],
    meta: meta("דדליין פנימי לעבודת ויקטור (+ משימת מעקב)", "Set a Victor work's internal deadline: the follow-up task (+ Google Task) is created or moved", [K("victorWork"), { name: "internalDeadline", kind: "ymd", required: true }], ["internalDeadline"], "ownerPatchVictorWork (lib/writes/victor)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onVictor, read: vFields,
    plan: (a, cur) => (realYmd(a.internalDeadline) ? finishPlan(cur, { internalDeadline: String(a.internalDeadline) }) : refuse("BAD_DATE", "תאריך לא תקין")),
    apply: (d, id, a) => d.ownerPatchVictorWork(id, { internalDeadline: a.internalDeadline }),
    requiredValues: (_a, after) => [String(after.internalDeadline)],
    warnings: (c) => [c.hasTask ? "משימת המעקב הקיימת (ו-Google Task שלה) תזוז לתאריך הזה" : "תיווצר משימת 'מעקב ויקטור' (ו-Google Task אם מחובר)"],
    disclosuresHe: ["ויקטור לא רואה את הדדליין הפנימי ולא מקבל Push"],
  },
  {
    actionId: "NOTIFY_VICTOR_WORK", kinds: ["victor-work"],
    meta: meta("שליחת העבודה לויקטור (Push)", "Send Victor the 'new work' push (server-built; needs a Victor-facing title)", [K("victorWork")], ["notified"], "notifyVictorWork (lib/writes/victor)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onVictor(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, notified: false } }; },
    async read(d, id) { const f = await vFields(d, id); return f ? { ...f, notified: false } : null; },
    plan: (_a, cur) => (String(cur.title ?? "").trim() ? { ok: true, after: { notified: true } } : refuse("NO_TITLE", "חסר שם עבודה לויקטור — קובעים אותו קודם")),
    async apply(d, id) { const r = await d.notifyVictorWork(id); if (!r.ok) throw new Error(`not sent: ${r.reason}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: () => ["ויקטור"],
    disclosuresHe: ["נשלח Push לויקטור (ועותק אליך) עם שם העבודה — התוכן נבנה בשרת", "שום רשומה לא משתנה"],
  },
  {
    actionId: "UPDATE_VICTOR_VERSION_REVIEW", kinds: ["victor-review"],
    meta: meta("טיוטת הערות לגרסה של ויקטור", "Save a draft of the notes on ONE Victor version (per-version write, claimed — nothing sent)", [K("victorWork"), T("versionKey", true), T("notes", true)], ["notes"], "saveVictorReviewDraft (lib/writes/victor)", {}),
    async resolve(d, a) {
      const r = await onVictor(d, a); if ("ok" in r) return r;
      const vk = text(a.versionKey, 80); if (vk === null) return refuse("BAD_TEXT", "איזו גרסה?");
      const rv = await d.readVictorReview(r.id, vk.trim());
      return { key: `victor-work:${r.id}`, id: r.id, label: `${r.label} · ${vk.trim()}`, fields: { notes: rv?.notes ?? "", draft: rv?.draft ?? false } };
    },
    async read(d, id, a) { const rv = await d.readVictorReview(id, String(a?.versionKey ?? "").trim()); return (await d.readVictorWorkFull(id)) ? { notes: rv?.notes ?? "", draft: rv?.draft ?? false } : null; },
    plan(a, cur) { const t = text(a.notes); return t === null ? refuse("BAD_TEXT", "טקסט חסר") : finishPlan(cur, { notes: t.trim() }); },
    async apply(d, id, after, args) { const vk = String(args.versionKey).trim(); const r = await d.saveVictorReviewDraft(id, vk, String(after.notes)); if (r !== "ok") throw new Error(`draft not saved: ${r}`); return { receipt: vk }; },
    async verify(d, id, after, out) { const rv = await d.readVictorReview(id, String(out.receipt)); return !!rv && rv.notes === after.notes && rv.draft; },
    disclosuresHe: ["נשמרת טיוטה בלבד — לא נשלח כלום לויקטור (שליחה היא פעולה נפרדת)", "רק הגרסה הזאת משתנה; ביקורות של גרסאות אחרות לא נדרסות"],
  },
  {
    actionId: "SEND_VICTOR_VERSION_NOTES", kinds: ["victor-work"],
    meta: meta("שליחת ההערות על גרסה לויקטור (Push)", "Send Victor the saved notes of one version (push; the review is marked sent)", [K("victorWork"), T("versionKey", true)], ["notesSent"], "sendVictorVersionNotes (lib/writes/victor)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) {
      const r = await onVictor(d, a); if ("ok" in r) return r;
      const vk = text(a.versionKey, 80); if (vk === null) return refuse("BAD_TEXT", "איזו גרסה?");
      const rv = await d.readVictorReview(r.id, vk.trim());
      return { ...r, fields: { ...r.fields, notesSent: false, hasNotes: !!rv?.notes?.trim() } };
    },
    async read(d, id, a) { const f = await vFields(d, id); if (!f) return null; const rv = await d.readVictorReview(id, String(a?.versionKey ?? "").trim()); return { ...f, notesSent: false, hasNotes: !!rv?.notes?.trim() }; },
    plan: (_a, cur) => (!String(cur.title ?? "").trim() ? refuse("NO_TITLE", "חסר שם עבודה לויקטור") : !cur.hasNotes ? refuse("NO_NOTES", "אין הערות שמורות לגרסה הזאת") : { ok: true, after: { notesSent: true } }),
    async apply(d, id, _a, args) { const r = await d.sendVictorVersionNotes(id, String(args.versionKey).trim()); if (!r.ok) throw new Error(`not sent: ${r.reason}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: (a) => ["ויקטור", String(a.versionKey)],
    disclosuresHe: ["נשלח Push לויקטור שיש הערות על הגרסה; ההערות נרשמות כנשלחו", "תוכן ההערות הוא מה ששמור כרגע בגרסה"],
  },
  {
    actionId: "REMOVE_VICTOR_WORK", kinds: ["victor-work"],
    meta: meta("הסרת עבודת ויקטור", "Remove a Victor work: its follow-up task (+ Google Task) first, then the work (the Dropbox folder stays)", [K("victorWork")], ["exists"], "removeVictorWork (lib/writes/victor)", { effects: ["GOOGLE_TASKS", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onVictor(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await vFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { await d.removeVictorWork(id); },
    async verify(d, id) { return (await d.readVictorWorkFull(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [c.hasTask ? "משימת המעקב (ו-Google Task שלה) תימחק לפני העבודה" : "אין משימת מעקב"],
    disclosuresHe: ["העבודה נמחקת לצמיתות; הקבצים והתיקייה ב-Dropbox לא נמחקים", "המשכורת לא משתנה (היא לפי חודש)", "לא יישלח Push"],
  },
  {
    actionId: "UPDATE_VICTOR_SETTINGS", kinds: ["system"],
    meta: meta("הגדרות ויקטור (משכורת / מטבע / יום תשלום / יעד / ימי תקיעה)", "Update Victor settings through the app's own validator (the goal is a KPI, never a pay rule)", [{ name: "monthlySalary", kind: "money", required: false }, { name: "salaryCurrency", kind: "enum", required: false, values: VICTOR_SALARY_CURRENCIES as readonly string[] }, { name: "salaryPayDay", kind: "number", required: false }, { name: "monthlyGoal", kind: "number", required: false }, { name: "stuckAfterDays", kind: "number", required: false }], ["monthlySalary", "salaryCurrency", "salaryPayDay", "monthlyGoal", "stuckAfterDays"], "updateVictorSettings (lib/vendor-store) via validateVictorSettingsPatch", { effects: ["SETTINGS", "FINANCE"], riskClass: "FINANCIAL" }),
    async resolve(d) { return { key: "system:victor-settings", id: "victor-settings", label: "הגדרות ויקטור", fields: { ...(await d.readVictorSettings()) } }; },
    read: async (d) => ({ ...(await d.readVictorSettings()) }),
    plan(a, cur) {
      const patch = Object.fromEntries(["monthlySalary", "salaryCurrency", "salaryPayDay", "monthlyGoal", "stuckAfterDays"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      const v = validateVictorSettingsPatch(patch);
      if (!v.ok) return refuse("INVALID_SETTINGS", v.errors.join("; "));
      return finishPlan(cur, v.value as Fields);
    },
    apply: (d, _id, a) => d.updateVictorSettings({ ...a }),
    requiredValues: (_a, after) => Object.entries(after).map(([k, v]) => (k === "monthlySalary" ? String(Number(v).toLocaleString("en-US")) : String(v))),
    warnings: (c) => [`היום: משכורת ${money(Number(c.monthlySalary), String(c.salaryCurrency))}, יום ${c.salaryPayDay}, יעד ${c.monthlyGoal}`],
    disclosuresHe: ["משכורת / מטבע חלים על חודשים שעוד לא נרשמו; שורות כספים קיימות לא משתנות", "היעד החודשי הוא KPI — לא כלל שכר", "לא יישלח Push"],
  },
  {
    actionId: "RECORD_VICTOR_SALARY_MONTH", kinds: ["victor-month"],
    meta: meta("רישום משכורת חודש של ויקטור בכספים", "Create the salary month's expense row (duplicate-guarded by the salary key; 'historic paid' records it as שולם)", [T("workMonth", true), { name: "amount", kind: "money", required: true }, { name: "currency", kind: "enum", required: true, values: VICTOR_SALARY_CURRENCIES as readonly string[] }, { name: "historicPaid", kind: "boolean", required: false }, { name: "paidDate", kind: "ymd", required: false }], ["rowStatus", "rowAmount", "rowCurrency"], "recordVictorSalaryMonth (lib/writes/victor)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete / cancel the row through the Finance primitives" }),
    resolve: onMonth, read: (d, id) => monthFields(d, id),
    plan(a, cur) {
      if (cur.rowStatus && cur.rowStatus !== "בוטל") return refuse("DUPLICATE", `לחודש כבר יש שורת משכורת (${cur.rowStatus}) — לסימון שולם משתמשים בסטטוס של הרשומה`);
      if (typeof a.amount !== "number" || !(a.amount > 0)) return refuse("BAD_MONEY", "סכום לא תקין");
      if (a.paidDate !== undefined && !realYmd(a.paidDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.historicPaid === true && a.paidDate === undefined) return refuse("BAD_DATE", "תשלום היסטורי צריך תאריך תשלום");
      return { ok: true, after: { rowStatus: a.historicPaid === true ? "שולם" : "לא שולם", rowAmount: a.amount, rowCurrency: String(a.currency) } };
    },
    async apply(d, id, after, a) { const r = await d.recordVictorSalaryMonth({ workMonth: id, amount: Number(after.rowAmount), currency: String(after.rowCurrency), historicPaid: a.historicPaid === true, paidDate: str(a.paidDate) }); if (r !== "ok") throw new Error(`salary row not recorded: ${r}`); },
    requiredValues: (a, after) => [String(a.workMonth), money(Number(after.rowAmount), String(after.rowCurrency)), String(after.rowStatus)],
    warnings: (c) => [...(c.amountOverride !== null ? [`יש הצהרת סכום לחודש: ${c.amountOverride}`] : []), ...(c.statusOverride ? [`יש הצהרת סטטוס לחודש: ${c.statusOverride}`] : []), ...(c.rowStatus === "בוטל" ? ["שורה מבוטלת קיימת — היא תשמש מחדש (כמו באפליקציה)"] : [])],
    disclosuresHe: ["חודש נחשב משולם רק כששורת הכספים שלו 'שולם'", "$ ו-₪ לא מחוברים; לא יישלח Push"],
  },
  {
    actionId: "SET_VICTOR_SALARY_OVERRIDE", kinds: ["victor-month"],
    meta: meta("הצהרת סכום / סטטוס לחודש משכורת של ויקטור", "Record the Owner's salary-month statement (amount and / or status override) — a statement, never a finance fact", [T("workMonth", true), { name: "amount", kind: "money", required: false }, { name: "status", kind: "enum", required: false, values: VICTOR_PAYMENT_STATUSES as readonly string[] }], ["amountOverride", "statusOverride"], "setSalaryAmountOverride / setSalaryStatusOverride (lib/vendor-store)", { effects: ["SETTINGS"], riskClass: "FINANCIAL" }),
    resolve: onMonth, read: (d, id) => monthFields(d, id),
    plan(a, cur) {
      const after: Fields = {};
      if (a.amount !== undefined) { if (typeof a.amount !== "number" || a.amount < 0) return refuse("BAD_MONEY", "סכום לא תקין"); after.amountOverride = a.amount; }
      if (a.status !== undefined) after.statusOverride = String(a.status);
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.setVictorSalaryOverride(id, { ...(a.amountOverride !== undefined ? { amount: Number(a.amountOverride) } : {}), ...(a.statusOverride !== undefined ? { status: String(a.statusOverride) } : {}) }),
    requiredValues: (a, after) => [String(a.workMonth), ...Object.values(after).map(String)],
    warnings: (c) => [c.rowStatus ? `שורת הכספים של החודש: ${c.rowStatus} ${c.rowAmount ?? ""}` : "אין עדיין שורת כספים לחודש", "הצהרה שסותרת את שורת הכספים תוצג כסתירה — היא לא משנה אותה"],
    disclosuresHe: ["נשמרת הצהרה שלך בלבד; שום רשומה כספית לא נוצרת או משתנה", "לא יישלח Push"],
  },
  {
    actionId: "SET_VICTOR_MONTH_PAYMENT_MARK", kinds: ["victor-month"],
    meta: meta("סימון תשלום חודשי (מפתח ישן) של ויקטור", "Set the legacy monthly payment mark (settings) — an Owner statement kept for the old card, never a finance fact", [T("workMonth", true), { name: "status", kind: "enum", required: true, values: VICTOR_PAYMENT_STATUSES as readonly string[] }, { name: "paidDate", kind: "ymd", required: false }], ["legacyMark"], "setVictorPaymentStatus (lib/vendor-store)", { effects: ["SETTINGS"], riskClass: "FINANCIAL" }),
    resolve: onMonth, read: (d, id) => monthFields(d, id),
    plan(a, cur) { if (a.paidDate !== undefined && !realYmd(a.paidDate)) return refuse("BAD_DATE", "תאריך לא תקין"); return finishPlan(cur, { legacyMark: String(a.status) }); },
    apply: (d, id, a, args) => d.setVictorLegacyPaymentMark(id, String(a.legacyMark), str(args.paidDate)),
    requiredValues: (a, after) => [String(a.workMonth), String(after.legacyMark)],
    disclosuresHe: ["זה מפתח הגדרות ישן — הצהרה שלך; חודש משולם רק כששורת הכספים 'שולם'", "לא יישלח Push"],
  },
];
