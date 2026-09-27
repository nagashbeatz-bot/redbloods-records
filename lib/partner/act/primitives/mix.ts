/**
 * SUNNY UNIVERSAL ACTION LAYER — Mix / mastering family (Steven and any engineer): works, status, price, payment,
 * order, finance re-sync, comments, versions, riddim lines, pre-mix notes and the two Steven pushes. Every write goes
 * through the existing stores + lib/writes/mix — the writers the Steven page / drawer use.
 *
 * App rules only: an engineer is a free-text name and only exactly "Steven" is Steven (his page's finance semantics:
 * skipFinanceSync + the id-linked payment expense; any other engineer: the drawer's auto-synced expense). Completed ≠
 * approved ≠ final files ≠ paid. $ and ₪ are never added. The latest version is the newest upload.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export type EngineerWorkView = { projectId: string | null; projectType: string; title: string; engineerName: string; workType: string; status: string; agreedPrice: number; currency: string; amountPaid: number; paymentDate: string | null; sentDate: string | null; internalDeadline: string | null; notes: string; expenseStatus: string | null };
type Res = { ok: boolean; reason?: string };
export interface MixFamilyWriters {
  readCommentAttachment(id: string): Promise<{ commentId: string; fileName: string } | null>;
  deleteCommentAttachment(commentId: string, id: string): Promise<string>;
  readEngineerWork(id: string): Promise<EngineerWorkView | null>;
  listEngineerOrder(engineerName: string): Promise<string[]>;
  projectTypeOf(projectId: string): Promise<string | null>;
  createEngineerWork(projectId: string | null, f: { engineerName: string; workTitle: string | null; workType: string; status: string; agreedPrice: number; currency: string; sentDate: string | null; internalDeadline: string | null; notes: string; skipFinanceSync: boolean }): Promise<string>;
  updateEngineerWork(id: string, f: Record<string, unknown>): Promise<void>;
  recordEngineerPayment(id: string, paid: boolean, paymentDate: string | null): Promise<void>;
  deleteEngineerWork(id: string): Promise<{ removedExpense: boolean }>;
  reorderEngineerWork(ids: string[]): Promise<void>;
  forceEngineerFinanceSync(id: string): Promise<string | null>;
  readMixCommentFull(id: string): Promise<{ versionId: string; workId: string; text: string; timestampSeconds: number | null; status: string; attachments: number } | null>;
  createMixComment(c: { versionId: string; text: string; timestampSeconds: number | null; role: string | null }): Promise<string>;
  editMixComment(id: string, p: { commentText?: string; timestampSeconds?: number }): Promise<void>;
  deleteMixComment(id: string): Promise<void>;
  deleteMixVersion(id: string): Promise<void>;
  isRiddimWork(workId: string): Promise<boolean>;
  readMixTarget(id: string): Promise<{ workId: string; name: string; kind: string; removed: boolean } | null>;
  addRiddimLine(workId: string, name: string): Promise<{ status: string; id: string }>;
  renameRiddimLine(id: string, name: string): Promise<string>;
  removeRiddimLine(id: string): Promise<string>;
  readPremixNote(id: string): Promise<{ targetId: string; text: string; status: string } | null>;
  createPremixNote(targetId: string, text: string): Promise<string>;
  updatePremixNote(id: string, p: { noteText?: string; status?: string }): Promise<void>;
  deletePremixNote(id: string): Promise<void>;
  notifyMixReady(workId: string, sendAgain: boolean): Promise<Res & { alreadySent?: boolean; skipped?: boolean }>;
  sendMixNotes(workId: string, versionId: string | null): Promise<Res & { skipped?: boolean }>;
}

/** Pinned to lib/types.ts SOUND_ENGINEER_STATUSES / SOUND_ENGINEER_WORK_TYPES + lib/steven-scope.ts by the family test. */
export const ENGINEER_STATUSES: readonly string[] = ["לא נשלח", "נשלח", "בתהליך", "חזר", "אושר", "בוטל"];
export const ENGINEER_WORK_TYPES: readonly string[] = ["מיקס", "מאסטר", "מיקס + מאסטר", "תיקונים"];
export const STEVEN = "Steven";
export const STEVEN_PROJECT_TYPES: readonly string[] = ["שיר", "רידים", "אלבום", "EP"];
const MIX_CURRENCIES: readonly string[] = ["$", "₪", "€"];
const ROLES: readonly string[] = ["mix", "acapella", "instrumental", "stems"];
const money = (n: number, c: string) => `${c}${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "MIX", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const isSteven = (f: Fields) => f.engineerName === STEVEN;

const workFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const w = await d.readEngineerWork(id); return w ? { ...w } : null; };
async function onWork(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.mixWork, ["mix-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת מיקס (mix-work:…)");
  const f = await workFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת המיקס");
  return { key: `mix-work:${k.id}`, id: k.id, label: `${f.title} — ${f.engineerName}`, fields: f };
}
const commentFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const c = await d.readMixCommentFull(id); return c ? { ...c } : null; };
async function onComment(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.mixComment, ["mix-comment"]); if (!k) return refuse("BAD_ENTITY", "צריך הערה (mix-comment:…)");
  const f = await commentFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההערה");
  return { key: `mix-comment:${k.id}`, id: k.id, label: String(f.text).slice(0, 60), fields: f };
}
const targetFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const t = await d.readMixTarget(id); return t ? { ...t } : null; };
async function onTarget(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.mixLine, ["mix-line"]); if (!k) return refuse("BAD_ENTITY", "צריך שורת רידים (mix-line:…)");
  const f = await targetFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את השורה");
  return { key: `mix-line:${k.id}`, id: k.id, label: String(f.name), fields: f };
}
const noteFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const n = await d.readPremixNote(id); return n ? { ...n } : null; };
async function onNote(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.premixNote, ["premix-note"]); if (!k) return refuse("BAD_ENTITY", "צריך הערת טרום-מיקס (premix-note:…)");
  const f = await noteFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההערה");
  return { key: `premix-note:${k.id}`, id: k.id, label: String(f.text).slice(0, 60), fields: f };
}
const withExists = (r: ResolvedTarget | PlanRefusal) => ("ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } });

export const MIX_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "DELETE_MIX_ATTACHMENT", kinds: ["mix-attachment"],
    meta: meta("מחיקת קובץ מצורף מהערת מיקס (רק הקובץ, ההערה נשארת)", "Delete one attachment of a mix comment — the stored file (best-effort) then the row; the comment stays", [K("attachment")], ["exists"], "deleteCommentAttachment (lib/writes/mix)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.attachment, ["mix-attachment"]); if (!k) return refuse("BAD_ENTITY", "צריך קובץ מצורף (mix-attachment:…)"); const r = await d.readCommentAttachment(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הקובץ המצורף"); return { key: `mix-attachment:${k.id}`, id: k.id, label: r.fileName, fields: { fileName: r.fileName, commentId: r.commentId, exists: true } }; },
    async read(d, id) { const r = await d.readCommentAttachment(id); return r ? { fileName: r.fileName, commentId: r.commentId, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.readCommentAttachment(id); if (!r) throw new Error("attachment gone"); const res = await d.deleteCommentAttachment(r.commentId, id); if (res !== "ok") throw new Error(res); },
    async verify(d, id) { return (await d.readCommentAttachment(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["ההערה עצמה נשארת; רק הקובץ המצורף נמחק", "לא נשלח כלום לאיש הסאונד"],
  },
  {
    actionId: "CREATE_ENGINEER_WORK", kinds: ["mix-work"],
    meta: meta("פתיחת עבודת מיקס / מאסטר למהנדס", "Create an engineer work (project-linked or standalone); a price creates its expense (Steven: no finance until paid, like his page)", [K("project", false), T("title"), T("engineerName", true), { name: "workType", kind: "enum", required: true, values: ENGINEER_WORK_TYPES }, { name: "status", kind: "enum", required: false, values: ENGINEER_STATUSES }, { name: "agreedPrice", kind: "money", required: false }, { name: "currency", kind: "enum", required: false, values: MIX_CURRENCIES }, { name: "sentDate", kind: "ymd", required: false }, { name: "internalDeadline", kind: "ymd", required: false }, T("notes")], ["engineerName", "workType", "status", "agreedPrice", "currency"], "createSoundEngineerWork (lib/sound-engineer-store)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: "delete the work (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.project, ["project"]); return { projectType: k ? await d.projectTypeOf(k.id) : null }; },
    async resolve(d, a) {
      const k = parseKey(a.project, ["project"]);
      if (a.project !== undefined && !k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
      const pt = k ? await d.projectTypeOf(k.id) : null;
      if (k && pt === null) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
      return { key: "mix-work:new", id: "new", label: `${String(a.engineerName ?? "")} — ${String(a.title ?? "")}`.trim(), fields: { projectType: pt } };
    },
    read: workFields,
    plan(a, cur) {
      const eng = text(a.engineerName, 80); if (eng === null) return refuse("BAD_TEXT", "שם המהנדס חסר");
      if (a.project === undefined && text(a.title, 200) === null) return refuse("MISSING_TARGET", "צריך פרויקט או שם עבודה");
      if (eng.trim() === STEVEN && a.project !== undefined && !STEVEN_PROJECT_TYPES.includes(String(cur.projectType ?? ""))) return refuse("STEVEN_PROJECT_TYPE", `ל-Steven שולחים רק פרויקטים מסוג ${STEVEN_PROJECT_TYPES.join(" / ")}`);
      if (a.agreedPrice !== undefined && (typeof a.agreedPrice !== "number" || a.agreedPrice < 0)) return refuse("BAD_MONEY", "מחיר לא תקין");
      if (typeof a.agreedPrice === "number" && a.agreedPrice > 0 && a.currency === undefined) return refuse("BAD_CURRENCY", "מחיר צריך מטבע מפורש");
      for (const k of ["sentDate", "internalDeadline"]) if (a[k] !== undefined && !realYmd(a[k])) return refuse("BAD_DATE", "תאריך לא תקין");
      return { ok: true, after: { engineerName: eng.trim(), workType: String(a.workType), status: String(a.status ?? "לא נשלח"), agreedPrice: Number(a.agreedPrice ?? 0), currency: String(a.currency ?? "$") } };
    },
    async apply(d, _id, after, a) {
      return { createdId: await d.createEngineerWork(parseKey(a.project, ["project"])?.id ?? null, { engineerName: String(after.engineerName), workTitle: str(a.title)?.trim() || null, workType: String(after.workType), status: String(after.status), agreedPrice: Number(after.agreedPrice), currency: String(after.currency), sentDate: str(a.sentDate) ?? null, internalDeadline: str(a.internalDeadline) ?? null, notes: str(a.notes) ?? "", skipFinanceSync: after.engineerName === STEVEN }) };
    },
    async verify(d, id, after) { const w = await d.readEngineerWork(id); return !!w && w.engineerName === after.engineerName && w.agreedPrice === after.agreedPrice && w.status === after.status; },
    requiredValues: (_a, after) => [String(after.engineerName), ...(Number(after.agreedPrice) > 0 ? [money(Number(after.agreedPrice), String(after.currency))] : [])],
    disclosuresHe: ["מהנדס שאינו Steven: מחיר > 0 יוצר הוצאה צפויה מקושרת (כמו במגירה); Steven: כסף נרשם רק כשמסמנים שולם (כמו בדף שלו)", "הפתיחה לא שולחת כלום למהנדס — שליחה / Push הם פעולות נפרדות", "$ ו-₪ לא מחוברים"],
  },
  {
    actionId: "UPDATE_ENGINEER_WORK", kinds: ["mix-work"],
    meta: meta("עדכון עבודת מיקס (מהנדס / סוג / תאריך שליחה / דדליין / הערות)", "Update an engineer work's details (non-Steven: the linked expense re-syncs on an engineer / type change)", [K("mixWork"), T("engineerName"), { name: "workType", kind: "enum", required: false, values: ENGINEER_WORK_TYPES }, { name: "sentDate", kind: "ymd", required: false }, { name: "internalDeadline", kind: "ymd", required: false }, T("notes")], ["engineerName", "workType", "sentDate", "internalDeadline", "notes"], "updateSoundEngineerWork (lib/sound-engineer-store)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "YES" }),
    resolve: onWork, read: workFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.engineerName !== undefined) { const t = text(a.engineerName, 80); if (t === null) return refuse("BAD_TEXT", "שם מהנדס לא תקין"); after.engineerName = t.trim(); }
      if (a.workType !== undefined) after.workType = String(a.workType);
      for (const k of ["sentDate", "internalDeadline"] as const) if (a[k] !== undefined) { if (!realYmd(a[k])) return refuse("BAD_DATE", "תאריך לא תקין"); after[k] = String(a[k]); }
      if (a.notes !== undefined) { const t = text(a.notes); if (t === null) return refuse("BAD_TEXT", "הערות לא תקינות"); after.notes = t; }
      if (after.engineerName === STEVEN && cur.projectId && !STEVEN_PROJECT_TYPES.includes(String(cur.projectType))) return refuse("STEVEN_PROJECT_TYPE", `ל-Steven רק פרויקטים מסוג ${STEVEN_PROJECT_TYPES.join(" / ")}`);
      return finishPlan(cur, after);
    },
    apply: async (d, id, a) => { const cur = await d.readEngineerWork(id); await d.updateEngineerWork(id, { ...a, skipFinanceSync: cur?.engineerName === STEVEN }); },
    requiredValues: (_a, after) => [after.engineerName, after.internalDeadline].filter((x) => x !== undefined).map(String),
    disclosuresHe: ["מהנדס שאינו Steven: החלפת מהנדס / סוג מעדכנת את שורת ההוצאה המקושרת", "לא יישלח Push"],
  },
  {
    actionId: "SET_ENGINEER_WORK_STATUS", kinds: ["mix-work"],
    meta: meta("שינוי סטטוס עבודת מיקס", "Change an engineer work's status (a Steven work → אושר runs the app's completion flow: project sync, final-files request, push)", [K("mixWork"), { name: "status", kind: "enum", required: true, values: ENGINEER_STATUSES }], ["status"], "updateSoundEngineerWork (lib/sound-engineer-store)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "PARTIAL" }),
    resolve: onWork, read: workFields,
    plan: (a, cur) => (ENGINEER_STATUSES.includes(String(a.status)) ? finishPlan(cur, { status: String(a.status) }) : refuse("BAD_ENUM", "סטטוס לא מוכר")),
    apply: async (d, id, a) => { const cur = await d.readEngineerWork(id); await d.updateEngineerWork(id, { status: a.status, skipFinanceSync: cur?.engineerName === STEVEN }); },
    requiredValues: (_a, after) => [String(after.status)],
    warnings: (c) => (isSteven(c) ? ["עבודה של Steven: 'אושר' מפעיל את זרימת ההשלמה של האפליקציה — אם זו העבודה הפתוחה האחרונה, הפרויקט עובר להושלם, נפתחת בקשת קבצים סופיים ונשלח Push; פתיחה מחדש משחררת את הבקשה"] : []),
    disclosuresHe: ["הושלם ≠ אושר ≠ קבצים סופיים ≠ שולם — הסטטוס לא משנה כסף", "Push נשלח רק במעבר אמיתי להשלמה של Steven (כמו באפליקציה)"],
  },
  {
    actionId: "SET_ENGINEER_WORK_PRICE", kinds: ["mix-work"],
    meta: meta("מחיר / מטבע של עבודת מיקס", "Set an engineer work's agreed price / currency (non-Steven: the linked expense re-syncs)", [K("mixWork"), { name: "agreedPrice", kind: "money", required: true }, { name: "currency", kind: "enum", required: true, values: MIX_CURRENCIES }], ["agreedPrice", "currency"], "updateSoundEngineerWork (lib/sound-engineer-store)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "YES" }),
    resolve: onWork, read: workFields,
    plan(a, cur) { if (typeof a.agreedPrice !== "number" || a.agreedPrice < 0) return refuse("BAD_MONEY", "מחיר לא תקין"); return finishPlan(cur, { agreedPrice: a.agreedPrice, currency: String(a.currency) }); },
    apply: async (d, id, a) => { const cur = await d.readEngineerWork(id); await d.updateEngineerWork(id, { ...a, skipFinanceSync: cur?.engineerName === STEVEN }); },
    requiredValues: (_a, after) => [money(Number(after.agreedPrice), String(after.currency))],
    warnings: (c) => [`היום: ${money(Number(c.agreedPrice), String(c.currency))}`],
    disclosuresHe: ["מהנדס שאינו Steven: שורת ההוצאה המקושרת מתעדכנת; Steven: הכסף נרשם כשמסמנים שולם", "אין המרת מטבע", "לא יישלח Push"],
  },
  {
    actionId: "RECORD_ENGINEER_PAYMENT", kinds: ["mix-work"],
    meta: meta("סימון עבודת מיקס כשולמה / לא שולמה", "Mark an engineer work paid (+ payment date) or unpaid — exactly the app's flow (Steven: payment push + the id-linked expense)", [K("mixWork"), { name: "paid", kind: "boolean", required: true }, { name: "paymentDate", kind: "ymd", required: false }], ["amountPaid", "paymentDate"], "recordEngineerPayment (lib/writes/mix)", { effects: ["FINANCE", "PUSH"], riskClass: "FINANCIAL", reversible: "PARTIAL" }),
    resolve: onWork, read: workFields,
    plan(a, cur) {
      if (typeof a.paid !== "boolean") return refuse("BAD_ARGS", "שולם: כן / לא");
      if (a.paid && !(Number(cur.agreedPrice) > 0)) return refuse("NO_PRICE", "לעבודה אין מחיר — קובעים מחיר קודם");
      if (a.paid && !realYmd(a.paymentDate)) return refuse("BAD_DATE", "צריך תאריך תשלום");
      return finishPlan(cur, a.paid ? { amountPaid: Number(cur.agreedPrice), paymentDate: String(a.paymentDate) } : { amountPaid: 0, paymentDate: null });
    },
    apply: (d, id, a) => d.recordEngineerPayment(id, Number(a.amountPaid) > 0, (a.paymentDate as string | null) ?? null),
    requiredValues: (_a, after) => (Number(after.amountPaid) > 0 ? ["שולם", String(after.paymentDate)] : ["לא שולם"]),
    warnings: (c) => [`${c.engineerName}: ${money(Number(c.agreedPrice), String(c.currency))}`, ...(isSteven(c) ? ["Steven: הוצאה ששולמה נרשמת בכספים (או נמחקת בביטול), ו-Push 'התשלום אושר' נשלח במעבר לשולם"] : [])],
    disclosuresHe: ["שולם רק כשהסכום ששולם ≥ המחיר ויש תאריך — הכלל של האפליקציה", "$ ו-₪ לא מחוברים"],
  },
  {
    actionId: "DELETE_ENGINEER_WORK", kinds: ["mix-work"],
    meta: meta("מחיקת עבודת מיקס", "Delete an engineer work (its UNPAID linked expense goes with it; a paid expense stays as history)", [K("mixWork")], ["exists"], "deleteEngineerWorkClean (lib/writes/mix)", { effects: ["FINANCE", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return withExists(await onWork(d, a)); },
    async read(d, id) { const f = await workFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const r = await d.deleteEngineerWork(id); return { receipt: r.removedExpense }; },
    async verify(d, id) { return (await d.readEngineerWork(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [c.expenseStatus ? (c.expenseStatus === "שולם" ? "ההוצאה המקושרת שולמה — היא נשארת בכספים" : `ההוצאה המקושרת ('${c.expenseStatus}') תימחק איתה`) : "אין הוצאה מקושרת"],
    disclosuresHe: ["העבודה נמחקת לצמיתות; הגרסאות / ההערות שלה לא נגישות יותר מהדף", "לא יישלח Push"],
  },
  {
    actionId: "MOVE_ENGINEER_WORK", kinds: ["mix-work"],
    meta: meta("שינוי מיקום עבודה ברשימת המהנדס", "Move a work to a position in its engineer's job list", [K("mixWork"), { name: "position", kind: "number", required: true }], ["position"], "reorderSoundEngineerWork (lib/sound-engineer-store)", { riskClass: "SAFE_REVERSIBLE" }),
    async resolve(d, a) { const r = await onWork(d, a); if ("ok" in r) return r; const ids = await d.listEngineerOrder(String(r.fields.engineerName)); return { ...r, fields: { ...r.fields, position: ids.indexOf(r.id) + 1, count: ids.length } }; },
    async read(d, id) { const f = await workFields(d, id); if (!f) return null; const ids = await d.listEngineerOrder(String(f.engineerName)); return { ...f, position: ids.indexOf(id) + 1, count: ids.length }; },
    plan(a, cur) { const p = Number(a.position); if (!Number.isInteger(p) || p < 1 || p > Number(cur.count)) return refuse("BAD_NUMBER", `מיקום בין 1 ל-${cur.count}`); return finishPlan(cur, { position: p }); },
    async apply(d, id, a) {
      const w = await d.readEngineerWork(id); if (!w) throw new Error("work not found");
      const ids = (await d.listEngineerOrder(w.engineerName)).filter((x) => x !== id);
      ids.splice(Number(a.position) - 1, 0, id);
      await d.reorderEngineerWork(ids);
    },
    disclosuresHe: ["רק הסדר ברשימה משתנה", "לא יישלח Push"],
  },
  {
    actionId: "FORCE_ENGINEER_FINANCE_SYNC", kinds: ["mix-work"],
    meta: meta("סנכרון מחדש של הוצאת עבודת מיקס", "Re-run the engineer work's expense sync (the drawer's 'sync' — for a failed auto-sync)", [K("mixWork")], ["synced"], "forceSyncTransaction (lib/sound-engineer-store)", { effects: ["FINANCE"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: null }),
    async resolve(d, a) { const r = await onWork(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, synced: false } }; },
    async read(d, id) { const f = await workFields(d, id); return f ? { ...f, synced: false } : null; },
    plan: (_a, cur) => (isSteven(cur) ? refuse("STEVEN_FLOW", "ל-Steven הכסף נרשם דרך סימון שולם (RECORD_ENGINEER_PAYMENT)") : Number(cur.agreedPrice) > 0 ? { ok: true, after: { synced: true } } : refuse("NO_PRICE", "אין מחיר לסנכרן")),
    async apply(d, id) { return { receipt: await d.forceEngineerFinanceSync(id) }; },
    verify: async (_d, _id, _a, out) => typeof out.receipt === "string" && out.receipt.length > 0,
    requiredValues: (_a, _after) => ["סנכרון"],
    warnings: (c) => [`${c.engineerName}: ${money(Number(c.agreedPrice), String(c.currency))} — שורת ההוצאה המקושרת תיווצר / תתעדכן`],
    disclosuresHe: ["שורה אחת מקושרת לפי המזהה — בלי כפילויות", "לא יישלח Push"],
  },
  {
    actionId: "ADD_MIX_COMMENT", kinds: ["mix-comment"],
    meta: meta("הוספת הערה לגרסת מיקס", "Add a timestamp or general comment on a mix version (Steven sees it on his page)", [K("mixVersion"), T("text", true), { name: "timestampSeconds", kind: "number", required: false }, { name: "role", kind: "enum", required: false, values: ROLES }], ["text", "timestampSeconds"], "createMixComment (lib/mix-comments-store)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the comment (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.mixVersion, ["mix-version"]); const v = k ? await d.readMixVersion(k.id) : null; return { versionLabel: v ? v.label : null }; },
    async resolve(d, a) { const k = parseKey(a.mixVersion, ["mix-version"]); if (!k) return refuse("BAD_ENTITY", "צריך גרסה (mix-version:…)"); const v = await d.readMixVersion(k.id); if (!v) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הגרסה"); return { key: "mix-comment:new", id: "new", label: `הערה לגרסה ${v.label}`, fields: { versionLabel: v.label } }; },
    read: commentFields,
    plan(a) {
      const t = text(a.text); if (t === null) return refuse("BAD_TEXT", "טקסט ההערה חסר");
      if (a.timestampSeconds !== undefined && !(Number.isFinite(a.timestampSeconds) && Number(a.timestampSeconds) >= 0)) return refuse("BAD_NUMBER", "זמן בשניות לא תקין");
      return { ok: true, after: { text: t.trim(), timestampSeconds: a.timestampSeconds === undefined ? null : Number(a.timestampSeconds) } };
    },
    async apply(d, _id, after, a) { return { createdId: await d.createMixComment({ versionId: parseKey(a.mixVersion, ["mix-version"])!.id, text: String(after.text), timestampSeconds: (after.timestampSeconds as number | null) ?? null, role: str(a.role) ?? null }) }; },
    async verify(d, id, after) { const c = await d.readMixCommentFull(id); return !!c && c.text === after.text; },
    disclosuresHe: ["ההערה מופיעה ל-Steven בדף שלו (בלי Push — שליחת הערות היא פעולה נפרדת)"],
  },
  {
    actionId: "EDIT_MIX_COMMENT", kinds: ["mix-comment"],
    meta: meta("עריכת הערת מיקס (טקסט / זמן)", "Edit a mix comment's text or timestamp", [K("mixComment"), T("text"), { name: "timestampSeconds", kind: "number", required: false }], ["text", "timestampSeconds"], "updateMixComment (lib/mix-comments-store)", {}),
    resolve: onComment, read: commentFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.text !== undefined) { const t = text(a.text); if (t === null) return refuse("BAD_TEXT", "טקסט לא תקין"); after.text = t.trim(); }
      if (a.timestampSeconds !== undefined) { if (!(Number.isFinite(a.timestampSeconds) && Number(a.timestampSeconds) >= 0)) return refuse("BAD_NUMBER", "זמן לא תקין"); after.timestampSeconds = Number(a.timestampSeconds); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.editMixComment(id, { ...(a.text !== undefined ? { commentText: String(a.text) } : {}), ...(a.timestampSeconds !== undefined ? { timestampSeconds: Number(a.timestampSeconds) } : {}) }),
    disclosuresHe: ["רק ההערה משתנה; הסטטוס (פתוח / טופל) לא", "לא יישלח Push"],
  },
  {
    actionId: "DELETE_MIX_COMMENT", kinds: ["mix-comment"],
    meta: meta("מחיקת הערת מיקס", "Delete a mix comment and its attachment files", [K("mixComment")], ["exists"], "deleteMixCommentWithAttachments (lib/writes/mix)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return withExists(await onComment(d, a)); },
    async read(d, id) { const f = await commentFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteMixComment(id),
    async verify(d, id) { return (await d.readMixCommentFull(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => (Number(c.attachments) > 0 ? [`${c.attachments} קבצים מצורפים יימחקו איתה`] : []),
    disclosuresHe: ["ההערה נמחקת לצמיתות, והקבצים המצורפים שלה נמחקים מהאחסון", "לא יישלח Push"],
  },
  {
    actionId: "DELETE_MIX_VERSION", kinds: ["mix-version"],
    meta: meta("מחיקת גרסת מיקס (והקובץ שלה)", "Delete a mix version and its stored file", [K("mixVersion")], ["exists"], "deleteMixVersionWithFile (lib/writes/mix)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.mixVersion, ["mix-version"]); if (!k) return refuse("BAD_ENTITY", "צריך גרסה (mix-version:…)"); const v = await d.readMixVersion(k.id); if (!v) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הגרסה"); return { key: `mix-version:${k.id}`, id: k.id, label: `גרסה ${v.label}`, fields: { ...v, exists: true } }; },
    async read(d, id) { const v = await d.readMixVersion(id); return v ? { ...v, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteMixVersion(id),
    async verify(d, id) { return (await d.readMixVersion(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["הגרסה והקובץ שלה נמחקים לצמיתות (העותק בנגן הפרויקט, אם הועתק, נשאר)", "לא יישלח Push"],
  },
  {
    actionId: "ADD_RIDDIM_LINE", kinds: ["mix-line"],
    meta: meta("הוספת שורת אמן לעבודת ריקודים", "Add an artist line to a riddim work (a removed line with the same name is restored)", [K("mixWork"), T("name", true)], ["name"], "addArtistTarget (lib/mix-targets-store)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "remove the line (soft)" }),
    createContext: async (d, a) => { const k = parseKey(a.mixWork, ["mix-work"]); return { riddim: k ? await d.isRiddimWork(k.id) : false }; },
    async resolve(d, a) { const k = parseKey(a.mixWork, ["mix-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת מיקס (mix-work:…)"); if (!(await d.readEngineerWork(k.id))) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את העבודה"); return { key: "mix-line:new", id: "new", label: String(a.name ?? ""), fields: { riddim: await d.isRiddimWork(k.id) } }; },
    read: targetFields,
    plan(a, cur) { if (!cur.riddim) return refuse("NOT_RIDDIM", "זו לא עבודת רידים"); const n = text(a.name, 80); if (n === null) return refuse("BAD_TEXT", "שם אמן חסר"); return { ok: true, after: { name: n.trim() } }; },
    async apply(d, _id, after, a) { const r = await d.addRiddimLine(parseKey(a.mixWork, ["mix-work"])!.id, String(after.name)); if (r.status === "duplicate") throw new Error("a line with this name already exists"); return { createdId: r.id }; },
    async verify(d, id, after) { const t = await d.readMixTarget(id); return !!t && t.name === after.name && !t.removed; },
    disclosuresHe: ["שורה חדשה בעבודת הריקודים (שורת האינסטרומנטל נוצרת אם חסרה)", "לא יישלח Push"],
  },
  {
    actionId: "RENAME_RIDDIM_LINE", kinds: ["mix-line"],
    meta: meta("שינוי שם שורת אמן בריקודים", "Rename a riddim artist line", [K("mixLine"), T("name", true)], ["name"], "renameArtistTarget (lib/mix-targets-store)", {}),
    resolve: onTarget, read: targetFields,
    plan(a, cur) { if (cur.kind === "instrumental") return refuse("INSTRUMENTAL", "את שורת האינסטרומנטל לא משנים"); const n = text(a.name, 80); if (n === null) return refuse("BAD_TEXT", "שם חסר"); return finishPlan(cur, { name: n.trim() }); },
    async apply(d, id, a) { const s = await d.renameRiddimLine(id, String(a.name)); if (s !== "ok") throw new Error(`rename refused: ${s}`); },
    disclosuresHe: ["רק השם משתנה; המיקסים וההערות נשארים בשורה", "לא יישלח Push"],
  },
  {
    actionId: "REMOVE_RIDDIM_LINE", kinds: ["mix-line"],
    meta: meta("הסרת שורת אמן מריקודים (רכה)", "Soft-remove a riddim artist line (its mixes / files / comments stay visible under 'removed')", [K("mixLine")], ["removed"], "softRemoveTarget (lib/mix-targets-store)", { riskClass: "NORMAL_BUSINESS", reversible: "YES", compensation: "add the line back by name (it is restored)" }),
    resolve: onTarget, read: targetFields,
    plan: (_a, cur) => (cur.kind === "instrumental" ? refuse("INSTRUMENTAL", "את שורת האינסטרומנטל לא מסירים") : finishPlan(cur, { removed: true })),
    async apply(d, id) { const s = await d.removeRiddimLine(id); if (s !== "ok") throw new Error(`remove refused: ${s}`); },
    disclosuresHe: ["הסרה רכה: המיקסים, הקבצים וההערות נשארים ומופיעים תחת 'הוסרו'", "לא יישלח Push"],
  },
  {
    actionId: "ADD_PREMIX_NOTE", kinds: ["premix-note"],
    meta: meta("הערת טרום-מיקס לשורת ריקודים", "Add a pre-mix note on a riddim line", [K("mixLine"), T("text", true)], ["text"], "createMixTargetNote (lib/mix-target-notes-store)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the note" }),
    createContext: async (d, a) => { const k = parseKey(a.mixLine, ["mix-line"]); const t = k ? await d.readMixTarget(k.id) : null; return { lineName: t ? t.name : null }; },
    async resolve(d, a) { const k = parseKey(a.mixLine, ["mix-line"]); if (!k) return refuse("BAD_ENTITY", "צריך שורה (mix-line:…)"); const t = await d.readMixTarget(k.id); if (!t) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את השורה"); return { key: "premix-note:new", id: "new", label: `הערה ל${t.name}`, fields: { lineName: t.name } }; },
    read: noteFields,
    plan(a) { const t = text(a.text); return t === null ? refuse("BAD_TEXT", "טקסט חסר") : { ok: true, after: { text: t.trim() } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createPremixNote(parseKey(a.mixLine, ["mix-line"])!.id, String(after.text)) }; },
    async verify(d, id, after) { const n = await d.readPremixNote(id); return !!n && n.text === after.text; },
    disclosuresHe: ["ההערה מופיעה ל-Steven בשורה (בלי Push)"],
  },
  {
    actionId: "UPDATE_PREMIX_NOTE", kinds: ["premix-note"],
    meta: meta("עדכון הערת טרום-מיקס (טקסט / פתוח / טופל)", "Update a pre-mix note's text or open / resolved status", [K("premixNote"), T("text"), { name: "status", kind: "enum", required: false, values: ["open", "resolved"] }], ["text", "status"], "updateMixTargetNote (lib/mix-target-notes-store)", {}),
    resolve: onNote, read: noteFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.text !== undefined) { const t = text(a.text); if (t === null) return refuse("BAD_TEXT", "טקסט לא תקין"); after.text = t.trim(); }
      if (a.status !== undefined) after.status = String(a.status);
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updatePremixNote(id, { ...(a.text !== undefined ? { noteText: String(a.text) } : {}), ...(a.status !== undefined ? { status: String(a.status) } : {}) }),
    disclosuresHe: ["רק ההערה משתנה", "לא יישלח Push"],
  },
  {
    actionId: "DELETE_PREMIX_NOTE", kinds: ["premix-note"],
    meta: meta("מחיקת הערת טרום-מיקס", "Delete a pre-mix note", [K("premixNote")], ["exists"], "deleteMixTargetNote (lib/mix-target-notes-store)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { return withExists(await onNote(d, a)); },
    async read(d, id) { const f = await noteFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deletePremixNote(id),
    async verify(d, id) { return (await d.readPremixNote(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["ההערה נמחקת לצמיתות", "לא יישלח Push"],
  },
  {
    actionId: "NOTIFY_MIX_READY", kinds: ["mix-work"],
    meta: meta("'שלח ל-Steven' — Push עבודה חדשה מוכנה", "Send Steven the 'new mix job ready' push (once per work unless sendAgain)", [K("mixWork"), { name: "sendAgain", kind: "boolean", required: false }], ["notified"], "notifyStevenMixReady (lib/steven-mix-ready-notify)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onWork(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, notified: false } }; },
    async read(d, id) { const f = await workFields(d, id); return f ? { ...f, notified: false } : null; },
    plan: (_a, cur) => (isSteven(cur) ? { ok: true, after: { notified: true } } : refuse("NOT_STEVEN", "ה-Push הזה קיים רק ל-Steven")),
    async apply(d, id, _a, args) { const r = await d.notifyMixReady(id, args.sendAgain === true); if (!r.ok || r.skipped || r.alreadySent) throw new Error(r.alreadySent ? "already sent for this work — ask again with sendAgain" : r.skipped ? "push is not allowed in this environment" : `not sent: ${r.reason ?? "unknown"}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: () => ["Steven"],
    disclosuresHe: ["נשלח Push ל-Steven: 'עבודה חדשה מוכנה' עם שם העבודה — התוכן נבנה בשרת", "בלי sendAgain, עבודה שכבר נשלחה לא נשלחת שוב (ואז אדווח שלא נשלח)"],
  },
  {
    actionId: "SEND_MIX_NOTES", kinds: ["mix-work"],
    meta: meta("'שלח הערות' ל-Steven (Push + מחזור תזכורות)", "Send Steven the 'notes are waiting' push for a work (optionally naming the version) — starts the app's reminder cycle", [K("mixWork"), K("mixVersion", false)], ["notesSent"], "notifyStevenMixNotes (lib/steven-notes-notify)", { effects: ["PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onWork(d, a); if ("ok" in r) return r; if (a.mixVersion !== undefined) { const v = parseKey(a.mixVersion, ["mix-version"]); const mv = v ? await d.readMixVersion(v.id) : null; if (!mv || mv.workId !== r.id) return refuse("ENTITY_NOT_FOUND", "הגרסה לא שייכת לעבודה"); } return { ...r, fields: { ...r.fields, notesSent: false } }; },
    async read(d, id) { const f = await workFields(d, id); return f ? { ...f, notesSent: false } : null; },
    plan: (_a, cur) => (isSteven(cur) ? { ok: true, after: { notesSent: true } } : refuse("NOT_STEVEN", "ה-Push הזה קיים רק ל-Steven")),
    async apply(d, id, _a, args) { const r = await d.sendMixNotes(id, parseKey(args.mixVersion, ["mix-version"])?.id ?? null); if (!r.ok || r.skipped) throw new Error(r.skipped ? "push is not allowed in this environment" : `not sent: ${r.reason ?? "unknown"}`); return { receipt: "sent" }; },
    verify: async (_d, _id, _a, out) => out.receipt === "sent",
    requiredValues: () => ["Steven"],
    disclosuresHe: ["נשלח Push ל-Steven שיש הערות, ומתחיל מחזור התזכורות של האפליקציה", "ההערות עצמן לא משתנות"],
  },
];
