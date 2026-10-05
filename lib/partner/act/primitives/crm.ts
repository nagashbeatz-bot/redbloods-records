/**
 * SUNNY UNIVERSAL ACTION LAYER — Clients, proposals, meetings, tasks and calendar family.
 * Every write goes through the SAME shared writer the Redbloods screens use (lib/writes/clients, proposals, meetings,
 * tasks, lib/tasks-store, lib/google-calendar). External writes (Google Calendar / Tasks) are declared, previewed and
 * need the exact values repeated in the approval; deletes need the target named in the approval.
 */
import type { ArgSpec } from "../types";
import { CLIENT_VOCABULARIES } from "@/lib/partner/system/clients";
import { COMMON_NO, finishPlan, notesAfter, parseKey, realYmd, refuse, text, isRefusal, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

type Client = { name: string; phone: string; email: string; type: string; status: string; notes: string };
type Proposal = { clientId: string | null; clientName: string; title: string; amount: number; currency: string; status: string; sentDate: string | null; followupDate: string | null; notes: string; linkedProjectId: string | null };
type Meeting = { clientId: string | null; clientName: string; projectId: string | null; date: string | null; time: string | null; duration: number; location: string; notes: string; status: string; hasCalendarEvent: boolean };
type Task = { title: string; notes: string | null; status: string; relatedType: string; relatedId: string | null; dueDate: string | null; startTime: string | null; endTime: string | null; mirrored: boolean };
type GEvent = { summary: string; start: string; end: string; location: string; description: string; attendeeCount: number };

export interface CrmFamilyWriters {
  readClient(id: string): Promise<Client | null>;
  countClientsNamed(name: string): Promise<number>;
  countClientLinks(id: string): Promise<{ projects: number; proposals: number; meetings: number; tasks: number }>;
  projectsNamingArtist(name: string): Promise<number>;
  createClient(c: Client): Promise<string>;
  patchClient(id: string, patch: Partial<Client>): Promise<void>;
  deleteClient(id: string): Promise<void>;
  readProposal(id: string): Promise<Proposal | null>;
  createProposal(p: { clientId: string; title: string; amount?: number; currency?: string; status?: string; sentDate?: string | null; followupDate?: string | null; notes?: string }): Promise<string>;
  updateProposal(id: string, patch: Record<string, unknown>): Promise<void>;
  deleteProposal(id: string): Promise<void>;
  convertProposal(id: string, projectName?: string): Promise<{ status: string; projectId?: string }>;
  projectExists(id: string): Promise<boolean>;
  readMeeting(id: string): Promise<Meeting | null>;
  createMeeting(m: { clientId: string; clientName: string; projectId?: string | null; date?: string | null; time?: string | null; duration?: number; location?: string; notes?: string; addToCalendar?: boolean }): Promise<{ id: string; calendarError: string | null }>;
  updateMeeting(id: string, patch: Record<string, unknown>): Promise<{ calendarSynced: boolean | null }>;
  deleteMeeting(id: string): Promise<void>;
  readTask(id: string): Promise<Task | null>;
  createTask(t: { title: string; notes?: string | null; status?: string; related_type: string; related_id?: string | null; due_date?: string | null; start_time?: string | null; end_time?: string | null }, mirror: boolean): Promise<{ id: string; mirrored: boolean }>;
  patchTask(id: string, patch: Record<string, unknown>): Promise<void>;
  deleteTask(id: string): Promise<"ok" | "not_found">;
  syncGoogleTasks(): Promise<{ synced: number }>;
  /** Open tasks with the same title after normalization (duplicate warning); throws when unreadable. */
  openTasksLike(title: string): Promise<Array<{ id: string; title: string; dueDate: string | null; relatedType: string | null; relatedId: string | null }>>;
  calendarConnected(): Promise<boolean>;
  /** Main-calendar events starting on this Israel day (duplicate warning); throws when unreadable. */
  calendarEventsOnDay(dayYmd: string): Promise<Array<{ id: string; summary: string; start: string }>>;
  readCalendarEvent(eventId: string): Promise<GEvent | null>;
  addCalendarEvent(e: { summary: string; start: string; end: string; description?: string; allDay?: boolean; attendees?: string[] }): Promise<string>;
  editCalendarEvent(eventId: string, patch: { summary?: string; startIso?: string; endIso?: string; location?: string; description?: string }): Promise<void>;
  removeCalendarEvent(eventId: string): Promise<void>;
  addGoogleTask(title: string, due: string, notes?: string): Promise<string>;
  readGoogleTask(id: string): Promise<{ title: string; due: string | null; status: string } | null>;
  googleTaskLinkedToTask(id: string): Promise<boolean>;
  removeGoogleTask(id: string): Promise<void>;
  disconnectGoogle(): Promise<void>;
}

const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = true): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = true): ArgSpec => ({ name, kind: "enum", required, values });
const D = (name: string, required = false): ArgSpec => ({ name, kind: "ymd", required });
const B = (name: string, required = false): ArgSpec => ({ name, kind: "boolean", required });
const N = (name: string, required = false): ArgSpec => ({ name, kind: "number", required });
const meta = (domain: string, he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta> = {}): PrimitiveMeta =>
  ({ domain, he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const TYPES = CLIENT_VOCABULARIES.clientTypes as readonly string[];
const CSTAT = CLIENT_VOCABULARIES.clientStatuses as readonly string[];
const PSTAT = CLIENT_VOCABULARIES.proposalStatuses as readonly string[];
const MSTAT = CLIENT_VOCABULARIES.meetingStatuses as readonly string[];
/** Pinned to lib/tasks-store TASK_STATUSES / TASK_RELATED_TYPES by scripts/test-sunny-act-crm.tsx (server-only module). */
export const TASK_STATUS_VALUES: readonly string[] = ["פתוח", "בוצע", "בוטל"];
export const TASK_RELATED_VALUES: readonly string[] = ["general", "client", "project", "red_film_production"];
const TSTAT = TASK_STATUS_VALUES;
const REL = TASK_RELATED_VALUES;
const CURRENCIES = ["₪", "$"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DT = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const money = (n: number, c: string) => `${c}${Number(n).toLocaleString("en-US")}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/*
 * Create-duplicate context (Question memory stage 7, Owner-approved 2026-10-05): a WARNING only, never a block. A live
 * lookup of what already exists; a failed lookup is "could not check" (dupCheck FAILED), never "no duplicate".
 */
const normTitle = (t: string) => t.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
async function taskDupContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const t = typeof a.title === "string" ? a.title : "";
  try {
    const same = (await d.openTasksLike(t.trim())).filter((r) => normTitle(r.title) === normTitle(t));
    const rel = typeof a.related === "string" ? a.related.slice(a.related.indexOf(":") + 1) : null;
    return { dupCheck: "OK", sameTitleOpen: same.length, sameTitleSameDate: typeof a.dueDate === "string" ? same.filter((r) => r.dueDate === a.dueDate).length : 0, sameTitleSameRecord: rel ? same.filter((r) => r.relatedId === rel).length : 0 };
  } catch { return { dupCheck: "FAILED" }; }
}
function taskDupWarnings(c: Fields): string[] {
  if (c.dupCheck === "FAILED") return ["לא הצלחתי לבדוק אם כבר קיימת משימה כזאת — זה לא אומר שאין"];
  const where = [Number(c.sameTitleSameDate) > 0 ? "באותו תאריך" : null, Number(c.sameTitleSameRecord) > 0 ? "על אותה רשומה" : null].filter(Boolean);
  if (where.length) return [`כבר יש משימה פתוחה עם אותה כותרת ${where.join(" ו")} — ליצור עוד אחת?`];
  return Number(c.sameTitleOpen) > 0 ? [`כבר יש ${c.sameTitleOpen} משימה פתוחה עם אותה כותרת`] : [];
}
async function eventDupContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const connected = await d.calendarConnected();
  const start = typeof a.start === "string" ? a.start : "";
  if (!connected || !realYmd(start.slice(0, 10))) return { connected };
  try {
    const same = (await d.calendarEventsOnDay(start.slice(0, 10))).filter((e) => normTitle(e.summary) === normTitle(String(a.summary ?? "")));
    return { connected, dupCheck: "OK", sameTitleSameDay: same.length, sameTitleSameStart: same.filter((e) => e.start === start).length };
  } catch { return { connected, dupCheck: "FAILED" }; }
}
function eventDupWarnings(c: Fields): string[] {
  if (c.dupCheck === "FAILED") return ["לא הצלחתי לבדוק ביומן אם כבר קיים אירוע כזה — זה לא אומר שאין"];
  if (Number(c.sameTitleSameStart) > 0) return ["כבר יש ביומן אירוע עם אותה כותרת באותה שעה — ליצור עוד אחד?"];
  return Number(c.sameTitleSameDay) > 0 ? ["כבר יש ביומן אירוע עם אותה כותרת באותו יום (בשעה אחרת)"] : [];
}

// ── readers / resolvers ─────────────────────────────────────────────────────────────────────────────────────────────
const clientFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const c = await d.readClient(id); return c ? { ...c } : null; };
const on = (kind: string, keyArg: string, read: (d: WriterDeps, id: string) => Promise<Fields | null>, label: (f: Fields) => string, notFoundHe: string) =>
  async (d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> => {
    const k = parseKey(args[keyArg], [kind]);
    if (!k) return refuse("BAD_ENTITY", `צריך מפתח ${kind} תקין (${kind}:…)`);
    const f = await read(d, k.id);
    return f ? { key: `${kind}:${k.id}`, id: k.id, label: label(f), fields: f } : refuse("ENTITY_NOT_FOUND", notFoundHe);
  };
const proposalFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const p = await d.readProposal(id); return p ? { ...p } : null; };
const meetingFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const m = await d.readMeeting(id); return m ? { ...m } : null; };
const taskFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const t = await d.readTask(id); return t ? { ...t } : null; };
const eventFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const e = await d.readCalendarEvent(id); return e ? { ...e } : null; };
const onClient = on("client", "client", clientFields, (f) => String(f.name), "לא מצאתי את הלקוח");
const onProposal = on("proposal", "proposal", proposalFields, (f) => `${f.title} (${f.clientName})`, "לא מצאתי את ההצעה");
const onMeeting = on("meeting", "meeting", meetingFields, (f) => `פגישה עם ${f.clientName} ${f.date ?? ""}`, "לא מצאתי את הפגישה");
const onTask = on("task", "task", taskFields, (f) => String(f.title), "לא מצאתי את המשימה");
const GEV = /^gcal-event:([a-zA-Z0-9_-]{5,100})$/;
async function onEvent(d: WriterDeps, args: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const m = typeof args.event === "string" ? GEV.exec(args.event) : null;
  if (!m) return refuse("BAD_ENTITY", "צריך אירוע יומן (gcal-event:…) מהיומן הראשי");
  const f = await eventFields(d, m[1]);
  return f ? { key: `gcal-event:${m[1]}`, id: m[1], label: String(f.summary || "אירוע"), fields: f } : refuse("ENTITY_NOT_FOUND", "לא מצאתי את האירוע ביומן הראשי");
}

// ── primitives ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const CRM_PRIMITIVES: readonly PrimitiveSpec[] = [
  // Clients
  {
    actionId: "CREATE_CLIENT", kinds: ["client"],
    meta: meta("CLIENT", "יצירת לקוח", "Create a client", [T("name"), T("phone", false), T("email", false), E("type", TYPES, false), E("status", CSTAT, false), T("notes", false)], ["name", "type", "status"], "createClientRecord (lib/writes/clients)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the new client (separate approved action)" }),
    createContext: async (d, a) => ({ sameName: typeof a.name === "string" ? await d.countClientsNamed(a.name.trim()) : 0 }),
    async resolve(d, a) { const n = text(a.name, 200); if (n === null) return refuse("BAD_TEXT", "שם הלקוח חסר"); return { key: "client:new", id: "new", label: n.trim(), fields: { sameName: await d.countClientsNamed(n.trim()) } }; },
    read: clientFields,
    plan(a, cur) {
      if (Number(cur.sameName) > 0) return refuse("DUPLICATE", "כבר קיים לקוח בשם הזה (המערכת לא מאפשרת כפילות)");
      const n = text(a.name, 200); if (n === null) return refuse("BAD_TEXT", "שם הלקוח חסר");
      if (a.type !== undefined && !TYPES.includes(String(a.type))) return refuse("BAD_ENUM", "סוג לקוח לא מוכר");
      if (a.status !== undefined && !CSTAT.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס לקוח לא מוכר");
      if (a.email !== undefined && a.email !== "" && !EMAIL.test(String(a.email))) return refuse("BAD_EMAIL", "כתובת מייל לא תקינה");
      return { ok: true, after: { name: n.trim(), type: String(a.type ?? "לקוח"), status: String(a.status ?? "חדש") } };
    },
    async apply(d, _id, a, args) { return { createdId: await d.createClient({ name: String(a.name), phone: str(args.phone) ?? "", email: str(args.email) ?? "", type: String(a.type), status: String(a.status), notes: str(args.notes) ?? "" }) }; },
    async verify(d, id, after) { const c = await d.readClient(id); return !!c && c.name === after.name; },
    disclosuresHe: ["נוצר לקוח חדש", "לא יישלח Push או הודעה; לא נוצרים פרויקט, הצעה או רשומה כספית"],
  },
  {
    actionId: "UPDATE_CLIENT_CONTACT", kinds: ["client"],
    meta: meta("CLIENT", "עדכון פרטי לקוח (טלפון / מייל / סוג / סטטוס / הערות)", "Update client fields (field-level; nothing else is blanked)", [K("client"), T("phone", false), T("email", false), E("type", TYPES, false), E("status", CSTAT, false), T("notes", false), E("mode", ["REPLACE", "APPEND"], false)], ["phone", "email", "type", "status", "notes"], "patchClient (lib/writes/clients)"),
    resolve: onClient, read: clientFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.phone !== undefined) { const t = text(a.phone, 40); if (t === null) return refuse("BAD_TEXT", "טלפון לא תקין"); after.phone = t.trim(); }
      if (a.email !== undefined) { if (!EMAIL.test(String(a.email))) return refuse("BAD_EMAIL", "כתובת מייל לא תקינה"); after.email = String(a.email).trim(); }
      if (a.type !== undefined) { if (!TYPES.includes(String(a.type))) return refuse("BAD_ENUM", "סוג לקוח לא מוכר"); after.type = String(a.type); }
      if (a.status !== undefined) { if (!CSTAT.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס לקוח לא מוכר"); after.status = String(a.status); }
      if (a.notes !== undefined) { const n = notesAfter({ ...a, mode: a.mode ?? "REPLACE" }, String(cur.notes ?? ""), "notes"); if (isRefusal(n)) return n; after.notes = n; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.patchClient(id, a as Partial<Client>),
    disclosuresHe: [...COMMON_NO, "רק השדות שציינת משתנים — שאר הפרטים נשמרים כמו שהם", "השם לא משתנה (שינוי שם הוא פעולה נפרדת כי הוא מעדכן פרויקטים)"],
  },
  {
    actionId: "RENAME_CLIENT", kinds: ["client"],
    meta: meta("CLIENT", "שינוי שם לקוח (מעדכן גם את שם האמן בפרויקטים שלו)", "Rename a client (the app rewrites the artist text of every project naming them)", [K("client"), T("name")], ["name", "projectsToRewrite"], "patchClient → saveClient rename cascade (lib/writes/clients)", { effects: ["CASCADE"], riskClass: "BULK", reversible: "PARTIAL", compensation: "rename back (a new approved plan)" }),
    async resolve(d, a) { const r = await onClient(d, a); if ("ok" in r) return r; return { ...r, fields: { ...r.fields, projectsToRewrite: await d.projectsNamingArtist(String(r.fields.name)) } }; },
    async read(d, id) { const c = await d.readClient(id); return c ? { ...c, projectsToRewrite: await d.projectsNamingArtist(c.name) } : null; },
    plan(a, cur) { const n = text(a.name, 200); if (n === null) return refuse("BAD_TEXT", "שם חדש חסר"); if (n.trim() === cur.name) return refuse("NO_CHANGE_NEEDED", "זה כבר השם"); return { ok: true, after: { name: n.trim(), projectsToRewrite: 0 } }; },
    apply: (d, id, a) => d.patchClient(id, { name: String(a.name) }),
    async verify(d, id, after) { const c = await d.readClient(id); return !!c && c.name === after.name; },
    requiredValues: (a) => [String(a.name ?? "").trim()],
    warnings: (c) => (Number(c.projectsToRewrite) > 0 ? [`שם האמן יתעדכן ב-${c.projectsToRewrite} פרויקטים שמזכירים את "${c.name}"`] : []),
    disclosuresHe: ["כל פרויקט שבו שם האמן הוא השם הישן יתעדכן לשם החדש (כמו באפליקציה)", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "DELETE_CLIENT", kinds: ["client"],
    meta: meta("CLIENT", "מחיקת לקוח (וההצעות שלו)", "Delete a client; its proposals (+ their follow-up tasks) are deleted first", [K("client")], ["exists"], "deleteClientRecord (lib/writes/clients)", { effects: ["DELETION", "CASCADE", "GOOGLE_TASKS"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onClient(d, a); if ("ok" in r) return r; return { ...r, fields: { name: r.fields.name, exists: true, ...(await d.countClientLinks(r.id)) } }; },
    async read(d, id) { const c = await d.readClient(id); return c ? { name: c.name, exists: true, ...(await d.countClientLinks(id)) } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteClient(id),
    async verify(d, id) { return (await d.readClient(id)) === null; },
    requiredValues: (_a, _after) => ["מחיקה"],
    warnings: (c) => [`יימחקו גם ${c.proposals} הצעות מחיר של הלקוח (ומשימות המעקב שלהן)`, `נשארים (לא נמחקים): ${c.projects} פרויקטים שמזכירים את השם, ${c.meetings} פגישות, ${c.tasks} משימות — הם יישארו בלי לקוח קיים`],
    disclosuresHe: ["הלקוח נמחק לצמיתות, וכל הצעות המחיר שלו נמחקות איתו (כולל משימות המעקב ו-Google Tasks שלהן)", "פרויקטים, פגישות ומשימות אחרות לא נמחקים", "לא יישלח Push או הודעה"],
  },
  // Proposals
  {
    actionId: "CREATE_PROPOSAL", kinds: ["proposal"],
    meta: meta("CLIENT", "יצירת הצעת מחיר", "Create a proposal (+ a follow-up task and Google Task when a follow-up date is given)", [K("client"), T("title"), { name: "amount", kind: "money", required: false }, E("currency", CURRENCIES, false), E("status", PSTAT, false), D("sentDate"), D("followupDate"), T("notes", false)], ["title", "amount", "currency", "status", "followupDate"], "createProposal (lib/writes/proposals)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL", compensation: "delete the proposal (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.client, ["client"]); return { clientExists: !!(k && (await d.readClient(k.id))) }; },
    async resolve(d, a) { const k = parseKey(a.client, ["client"]); if (!k) return refuse("BAD_ENTITY", "צריך לקוח (client:…)"); const c = await d.readClient(k.id); if (!c) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הלקוח"); return { key: "proposal:new", id: "new", label: `הצעה ל${c.name}`, fields: { clientExists: true } }; },
    read: proposalFields,
    plan(a, cur) {
      if (!cur.clientExists) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הלקוח");
      const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "כותרת חובה");
      if (a.amount !== undefined && (typeof a.amount !== "number" || a.amount < 0)) return refuse("BAD_MONEY", "סכום לא תקין");
      for (const k of ["sentDate", "followupDate"]) if (a[k] !== undefined && !realYmd(a[k])) return refuse("BAD_DATE", "תאריך לא תקין");
      if (a.status !== undefined && !PSTAT.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס הצעה לא מוכר");
      return { ok: true, after: { title: t.trim(), amount: Number(a.amount ?? 0), currency: String(a.currency ?? "₪"), status: String(a.status ?? "ממתין לתשובה"), followupDate: (a.followupDate as string | undefined) ?? null } };
    },
    async apply(d, _id, a, args) { return { createdId: await d.createProposal({ clientId: parseKey(args.client, ["client"])!.id, title: String(a.title), amount: Number(a.amount), currency: String(a.currency), status: String(a.status), sentDate: str(args.sentDate) ?? null, followupDate: (a.followupDate as string | null) ?? null, notes: str(args.notes) ?? "" }) }; },
    async verify(d, id, after) { const p = await d.readProposal(id); return !!p && p.title === after.title && p.amount === after.amount; },
    requiredValues: (_a, after) => (Number(after.amount) > 0 ? [money(Number(after.amount), String(after.currency))] : []),
    disclosuresHe: ["סכום הצעה הוא כסף פוטנציאלי — לא נרשם בכספים", "אם יש תאריך מעקב: נוצרת משימת מעקב + Google Task (אם גוגל מחובר)", "לא יישלח Push או הודעה ללקוח"],
  },
  {
    actionId: "UPDATE_PROPOSAL_INFO", kinds: ["proposal"],
    meta: meta("CLIENT", "עדכון פרטי הצעה (כותרת / תאריך שליחה / הערות)", "Update proposal title / sent date / notes (no follow-up change)", [K("proposal"), T("title", false), D("sentDate"), T("notes", false), E("mode", ["REPLACE", "APPEND"], false)], ["title", "sentDate", "notes"], "updateProposal (lib/writes/proposals)"),
    resolve: onProposal, read: proposalFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.title !== undefined) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "כותרת לא תקינה"); after.title = t.trim(); }
      if (a.sentDate !== undefined) { if (!realYmd(a.sentDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.sentDate = a.sentDate; }
      if (a.notes !== undefined) { const n = notesAfter({ ...a, mode: a.mode ?? "REPLACE" }, String(cur.notes ?? ""), "notes"); if (isRefusal(n)) return n; after.notes = n; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateProposal(id, a),
    disclosuresHe: [...COMMON_NO, "תאריך המעקב ומשימת המעקב לא משתנים"],
  },
  {
    actionId: "UPDATE_PROPOSAL_AMOUNT", kinds: ["proposal"],
    meta: meta("CLIENT", "עדכון סכום / מטבע של הצעה", "Update a proposal's amount / currency (potential money only)", [K("proposal"), { name: "amount", kind: "money", required: false }, E("currency", CURRENCIES, false)], ["amount", "currency"], "updateProposal (lib/writes/proposals)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: onProposal, read: proposalFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.amount !== undefined) { if (typeof a.amount !== "number" || a.amount < 0) return refuse("BAD_MONEY", "סכום לא תקין"); after.amount = a.amount; }
      if (a.currency !== undefined) { if (!CURRENCIES.includes(String(a.currency))) return refuse("BAD_ENUM", "מטבע לא מוכר"); after.currency = String(a.currency); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateProposal(id, a),
    requiredValues: (a, after) => [money(Number(after.amount ?? a.amount ?? 0), String(after.currency ?? a.currency ?? "₪"))],
    disclosuresHe: [...COMMON_NO, "סכום הצעה הוא כסף פוטנציאלי — לא נרשם בכספים"],
  },
  {
    actionId: "CHANGE_PROPOSAL_STATUS", kinds: ["proposal"],
    meta: meta("CLIENT", "שינוי סטטוס הצעה", "Change a proposal's status (converting to a project is a separate action)", [K("proposal"), E("status", PSTAT)], ["status"], "updateProposal (lib/writes/proposals)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: onProposal, read: proposalFields,
    plan(a, cur) { if (!PSTAT.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס הצעה לא מוכר"); return finishPlan(cur, { status: String(a.status) }); },
    apply: (d, id, a) => d.updateProposal(id, { status: a.status }),
    disclosuresHe: [...COMMON_NO, "'נסגר' כאן לא יוצר פרויקט — להמרה לפרויקט יש פעולה נפרדת"],
  },
  {
    actionId: "SET_PROPOSAL_FOLLOWUP", kinds: ["proposal"],
    meta: meta("CLIENT", "קביעת / ביטול תאריך מעקב להצעה", "Set or clear a proposal's follow-up date (moves its follow-up task + Google Task)", [K("proposal"), D("followupDate"), B("clear")], ["followupDate"], "updateProposal (lib/writes/proposals)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onProposal, read: proposalFields,
    plan(a, cur) { if (a.clear === true) return finishPlan(cur, { followupDate: null }); if (!realYmd(a.followupDate)) return refuse("BAD_DATE", "תאריך מעקב לא תקין"); return finishPlan(cur, { followupDate: a.followupDate }); },
    apply: (d, id, a) => d.updateProposal(id, { followupDate: a.followupDate ?? null }),
    requiredValues: (_a, after) => [after.followupDate ? String(after.followupDate) : "ביטול מעקב"],
    disclosuresHe: ["משימת המעקב של ההצעה נוצרת / זזה / נמחקת בהתאם, וכך גם ה-Google Task שלה (אם מחובר)", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "LINK_PROPOSAL_TO_PROJECT", kinds: ["proposal"],
    meta: meta("CLIENT", "קישור הצעה לפרויקט קיים", "Link a proposal to an existing project (the project must exist)", [K("proposal"), K("project")], ["linkedProjectId"], "updateProposal (lib/writes/proposals)", { riskClass: "NORMAL_BUSINESS" }),
    resolve: onProposal, read: proposalFields,
    plan(a, cur) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); return finishPlan(cur, { linkedProjectId: k.id }); },
    async apply(d, id, a) { if (!(await d.projectExists(String(a.linkedProjectId)))) throw new Error("the project does not exist"); await d.updateProposal(id, { linkedProjectId: a.linkedProjectId }); },
    disclosuresHe: [...COMMON_NO, "רק הקישור משתנה — סטטוס ההצעה והמחיר המוסכם לא משתנים"],
  },
  {
    actionId: "CONVERT_PROPOSAL", kinds: ["proposal"],
    meta: meta("CLIENT", "המרת הצעה לפרויקט", "Convert a proposal into a project (status נסגר; agreed price saved; follow-up task closed)", [K("proposal"), T("projectName", false)], ["linkedProjectId", "status"], "convertProposal (lib/writes/proposals, CAS-hardened)", { effects: ["FINANCE", "GOOGLE_TASKS"], riskClass: "FINANCIAL", reversible: "PARTIAL", compensation: null }),
    resolve: onProposal, read: proposalFields,
    plan(a, cur) { if (cur.linkedProjectId) return refuse("NO_CHANGE_NEEDED", "ההצעה כבר הומרה לפרויקט"); if (a.projectName !== undefined && text(a.projectName, 200) === null) return refuse("BAD_TEXT", "שם פרויקט לא תקין"); return { ok: true, after: { status: "נסגר", linkedProjectId: "set" } }; },
    async apply(d, id, _a, args) { const r = await d.convertProposal(id, str(args.projectName)?.trim()); if (r.status !== "ok") throw new Error(`convert refused: ${r.status}`); return { receipt: r.projectId ?? null }; },
    async verify(d, id) { const p = await d.readProposal(id); return !!p && p.status === "נסגר" && !!p.linkedProjectId; },
    requiredValues: () => [],
    warnings: (c) => (Number(c.amount) > 0 ? [`המחיר המוסכם של הפרויקט החדש יירשם: ${money(Number(c.amount), String(c.currency))}`] : ["סכום ההצעה 0 — לא יירשם מחיר מוסכם"]),
    disclosuresHe: ["נוצר פרויקט חדש (שם: ההצעה או השם שציינת; אמן: הלקוח)", "סוג הפרויקט לפי כלל הבעלים: שליו טסמה / אבי מולה → לייבל, אחרת לקוח", "ההצעה מסומנת 'נסגר' ומקושרת לפרויקט", "משימת המעקב נסגרת (וגם ב-Google Tasks אם מחובר)", "הגנה מכפילות: שתי בקשות במקביל לא יוצרות שני פרויקטים"],
  },
  {
    actionId: "DELETE_PROPOSAL", kinds: ["proposal"],
    meta: meta("CLIENT", "מחיקת הצעת מחיר", "Delete a proposal (its follow-up task + Google Task first)", [K("proposal")], ["exists"], "deleteProposal (lib/writes/proposals)", { effects: ["GOOGLE_TASKS", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onProposal(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const p = await d.readProposal(id); return p ? { ...p, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteProposal(id),
    async verify(d, id) { return (await d.readProposal(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["ההצעה נמחקת לצמיתות, יחד עם משימת המעקב שלה ו-Google Task שלה", "לא יישלח Push או הודעה"],
  },
  // Meetings
  {
    actionId: "CREATE_MEETING", kinds: ["meeting"],
    meta: meta("CLIENT", "קביעת פגישה עם לקוח", "Book a meeting with a client (optionally + a Google Calendar event)", [K("client"), K("project", false), D("date", true), T("time"), N("duration"), T("location", false), T("notes", false), B("addToCalendar")], ["date", "time", "duration", "addToCalendar"], "createMeeting (lib/writes/meetings)", { effects: ["CALENDAR"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL", compensation: "delete the meeting (separate approved action)" }),
    createContext: async (d, a) => { const k = parseKey(a.client, ["client"]); const c = k ? await d.readClient(k.id) : null; return { clientName: c?.name ?? null }; },
    async resolve(d, a) { const k = parseKey(a.client, ["client"]); if (!k) return refuse("BAD_ENTITY", "צריך לקוח (client:…)"); const c = await d.readClient(k.id); if (!c) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הלקוח"); return { key: "meeting:new", id: "new", label: `פגישה עם ${c.name}`, fields: { clientName: c.name } }; },
    read: meetingFields,
    plan(a, cur) {
      if (!cur.clientName) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הלקוח");
      if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); if (!TIME.test(String(a.time))) return refuse("BAD_TIME", "שעה לא תקינה (HH:MM)");
      if (a.duration !== undefined && ![30, 45, 60, 90, 120].includes(Number(a.duration))) return refuse("BAD_NUMBER", "משך: 30 / 45 / 60 / 90 / 120 דקות");
      if (a.project !== undefined && !parseKey(a.project, ["project"])) return refuse("BAD_ENTITY", "פרויקט לא תקין");
      return { ok: true, after: { date: String(a.date), time: String(a.time), duration: Number(a.duration ?? 60), addToCalendar: a.addToCalendar === true } };
    },
    async apply(d, _id, a, args) { const r = await d.createMeeting({ clientId: parseKey(args.client, ["client"])!.id, clientName: "", projectId: parseKey(args.project, ["project"])?.id ?? null, date: String(a.date), time: String(a.time), duration: Number(a.duration), location: str(args.location) ?? "", notes: str(args.notes) ?? "", addToCalendar: a.addToCalendar === true }); return { createdId: r.id, receipt: r.calendarError }; },
    async verify(d, id, after) { const m = await d.readMeeting(id); return !!m && m.date === after.date && m.time === after.time; },
    requiredValues: (_a, after) => [String(after.date), String(after.time)],
    disclosuresHe: ["נוצרת פגישה בסטטוס 'נקבעה'", "אם ביקשת יומן: נוצר אירוע ב-Google Calendar הראשי (בלי הזמנה ללקוח)", "לא יישלח Push או הודעה ללקוח"],
  },
  {
    actionId: "UPDATE_MEETING", kinds: ["meeting"],
    meta: meta("CLIENT", "עדכון פגישה (מועד / מקום / הערות / סטטוס / פרויקט)", "Update a meeting (its Google event follows a date / time / place change)", [K("meeting"), D("date"), T("time", false), N("duration"), T("location", false), T("notes", false), E("status", MSTAT, false), K("project", false)], ["date", "time", "duration", "location", "notes", "status", "projectId"], "updateMeeting (lib/writes/meetings)", { effects: ["CALENDAR"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onMeeting, read: meetingFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.date !== undefined) { if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); after.date = String(a.date); }
      if (a.time !== undefined) { if (!TIME.test(String(a.time))) return refuse("BAD_TIME", "שעה לא תקינה"); after.time = String(a.time); }
      if (a.duration !== undefined) { if (![30, 45, 60, 90, 120].includes(Number(a.duration))) return refuse("BAD_NUMBER", "משך לא תקין"); after.duration = Number(a.duration); }
      if (a.location !== undefined) { const t = text(a.location, 200); if (t === null) return refuse("BAD_TEXT", "מקום לא תקין"); after.location = t.trim(); }
      if (a.notes !== undefined) { const t = text(a.notes); if (t === null) return refuse("BAD_TEXT", "הערות לא תקינות"); after.notes = t; }
      if (a.status !== undefined) { if (!MSTAT.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס פגישה לא מוכר"); after.status = String(a.status); }
      if (a.project !== undefined) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "פרויקט לא תקין"); after.projectId = k.id; }
      return finishPlan(cur, after);
    },
    apply: async (d, id, a) => { const p: Record<string, unknown> = { ...a }; if ("projectId" in p) { p.project_id = p.projectId; delete p.projectId; } await d.updateMeeting(id, p); },
    requiredValues: (_a, after) => [after.date, after.time].filter((x) => x !== undefined && x !== null).map(String),
    disclosuresHe: ["אם לפגישה יש אירוע ביומן — הוא יזוז / יתעדכן בהתאם (שינוי סטטוס לא מוחק אותו)", "לא יישלח Push או הודעה ללקוח"],
  },
  {
    actionId: "DELETE_MEETING", kinds: ["meeting"],
    meta: meta("CLIENT", "מחיקת פגישה", "Delete a meeting (and its Google event)", [K("meeting")], ["exists"], "deleteMeeting (lib/writes/meetings)", { effects: ["CALENDAR", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onMeeting(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const m = await d.readMeeting(id); return m ? { ...m, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteMeeting(id),
    async verify(d, id) { return (await d.readMeeting(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["הפגישה נמחקת לצמיתות, וגם האירוע שלה ביומן (אם יש)", "לא יישלח Push או הודעה"],
  },
  // Tasks
  {
    actionId: "CREATE_TASK", kinds: ["task"],
    meta: meta("TASKS", "יצירת משימה", "Create a task (optionally mirrored to Google Tasks)", [T("title"), T("notes", false), E("relatedType", REL, false), K("related", false), D("dueDate"), T("startTime", false), T("endTime", false), B("mirrorToGoogle")], ["title", "relatedType", "dueDate", "mirrorToGoogle"], "createTaskWithOptionalGoogle (lib/writes/tasks)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL", compensation: "delete the task (separate approved action)" }),
    createContext: taskDupContext,
    async resolve(d, a) { const t = text(a.title, 300); if (t === null) return refuse("BAD_TEXT", "כותרת חובה"); return { key: "task:new", id: "new", label: t.trim(), fields: await taskDupContext(d, a) }; },
    read: taskFields,
    plan(a) {
      const t = text(a.title, 300); if (t === null) return refuse("BAD_TEXT", "כותרת חובה");
      const rt = String(a.relatedType ?? "general"); if (!REL.includes(rt)) return refuse("BAD_ENUM", "סוג קישור לא מוכר");
      const kinds: Record<string, string> = { client: "client", project: "project", red_film_production: "rf-production" };
      if (rt === "general" && a.related !== undefined) return refuse("BAD_ENTITY", "משימה כללית לא מקושרת לרשומה");
      if (rt !== "general" && !parseKey(a.related, [kinds[rt]])) return refuse("BAD_ENTITY", `צריך ${kinds[rt]}:…`);
      if (a.dueDate !== undefined && !realYmd(a.dueDate)) return refuse("BAD_DATE", "תאריך לא תקין");
      for (const k of ["startTime", "endTime"]) if (a[k] !== undefined && !TIME.test(String(a[k]))) return refuse("BAD_TIME", "שעה לא תקינה");
      if (a.mirrorToGoogle === true && !a.dueDate) return refuse("MISSING_DATE", "כדי לשקף ל-Google Tasks צריך תאריך יעד");
      return { ok: true, after: { title: t.trim(), relatedType: rt, dueDate: (a.dueDate as string | undefined) ?? null, mirrorToGoogle: a.mirrorToGoogle === true } };
    },
    async apply(d, _id, a, args) { const rel = args.related ? String(args.related) : null; const r = await d.createTask({ title: String(a.title), notes: str(args.notes) ?? null, status: "פתוח", related_type: String(a.relatedType), related_id: rel ? rel.slice(rel.indexOf(":") + 1) : null, due_date: (a.dueDate as string | null) ?? null, start_time: str(args.startTime) ?? null, end_time: str(args.endTime) ?? null }, a.mirrorToGoogle === true); return { createdId: r.id, receipt: r.mirrored }; },
    async verify(d, id, after, out) { const t = await d.readTask(id); return !!t && t.title === after.title && (after.mirrorToGoogle !== true || out.receipt === true); },
    requiredValues: (_a, after) => (after.mirrorToGoogle ? [String(after.dueDate)] : []),
    warnings: taskDupWarnings,
    disclosuresHe: ["נוצרת משימה פתוחה", "Google Task נוצר רק אם ביקשת שיקוף (ונשמר הקישור אליו)", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "UPDATE_TASK", kinds: ["task"],
    meta: meta("TASKS", "עדכון משימה (כותרת / הערות / תאריך / שעות)", "Update a task's title / notes / due date / times (a mirrored Google Task's due date follows)", [K("task"), T("title", false), T("notes", false), D("dueDate"), T("startTime", false), T("endTime", false)], ["title", "notes", "dueDate", "startTime", "endTime"], "patchTaskRecord (lib/writes/tasks)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onTask, read: taskFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.title !== undefined) { const t = text(a.title, 300); if (t === null) return refuse("BAD_TEXT", "כותרת לא תקינה"); after.title = t.trim(); }
      if (a.notes !== undefined) { const t = text(a.notes); if (t === null) return refuse("BAD_TEXT", "הערות לא תקינות"); after.notes = t; }
      if (a.dueDate !== undefined) { if (!realYmd(a.dueDate)) return refuse("BAD_DATE", "תאריך לא תקין"); after.dueDate = String(a.dueDate); }
      for (const k of ["startTime", "endTime"] as const) if (a[k] !== undefined) { if (!TIME.test(String(a[k]))) return refuse("BAD_TIME", "שעה לא תקינה"); after[k] = String(a[k]); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.patchTask(id, { ...(a.title !== undefined ? { title: a.title } : {}), ...(a.notes !== undefined ? { notes: a.notes } : {}), ...(a.dueDate !== undefined ? { due_date: a.dueDate } : {}), ...(a.startTime !== undefined ? { start_time: a.startTime } : {}), ...(a.endTime !== undefined ? { end_time: a.endTime } : {}) }),
    requiredValues: (_a, after) => (after.dueDate ? [String(after.dueDate)] : []),
    disclosuresHe: ["אם המשימה משוקפת ל-Google Tasks — תאריך היעד שם יזוז בהתאם", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SET_TASK_STATUS", kinds: ["task"],
    meta: meta("TASKS", "סימון משימה (פתוח / בוצע / בוטל)", "Complete / reopen / cancel a task (a mirrored Google Task follows)", [K("task"), E("status", TSTAT)], ["status"], "patchTaskRecord (lib/writes/tasks)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onTask, read: taskFields,
    plan(a, cur) { if (!TSTAT.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס משימה לא מוכר"); return finishPlan(cur, { status: String(a.status) }); },
    apply: (d, id, a) => d.patchTask(id, { status: a.status }),
    requiredValues: () => [],
    disclosuresHe: ["אם המשימה משוקפת ל-Google Tasks — היא תסומן שם כבוצעה / פתוחה", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "DELETE_TASK", kinds: ["task"],
    meta: meta("TASKS", "מחיקת משימה", "Delete a task (a linked Google Task is deleted first; a failure aborts)", [K("task")], ["exists"], "deleteTaskRecord (lib/writes/tasks)", { effects: ["GOOGLE_TASKS", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onTask(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const t = await d.readTask(id); return t ? { ...t, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { if ((await d.deleteTask(id)) !== "ok") throw new Error("task not found"); },
    async verify(d, id) { return (await d.readTask(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["המשימה נמחקת לצמיתות, וה-Google Task שלה לפניה (כישלון שם מבטל את כל המחיקה)", "לא יישלח Push או הודעה"],
  },
  {
    actionId: "SYNC_GOOGLE_TASKS_NOW", kinds: ["system"],
    meta: meta("TASKS", "סנכרון משימות שבוצעו ב-Google Tasks", "Pull completed Google Tasks into Redbloods now (same writer as the Tasks page)", [], ["requested"], "syncCompletedGoogleTasks (lib/writes/tasks)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL", compensation: null }),
    async resolve(d) { return { key: "system:google-tasks", id: "google-tasks", label: "Google Tasks", fields: { requested: false, connected: await d.calendarConnected() } }; },
    read: async (d) => ({ requested: false, connected: await d.calendarConnected() }),
    plan: (_a, cur) => (cur.connected ? { ok: true, after: { requested: true } } : refuse("NOT_CONNECTED", "Google לא מחובר — אין מה לסנכרן")),
    async apply(d) { return { receipt: (await d.syncGoogleTasks()).synced }; },
    verify: async (_d, _id, _a, out) => typeof out.receipt === "number",
    requiredValues: () => [],
    disclosuresHe: ["רק משימות שמשוקפות ל-Google וסומנו שם כבוצעו יסומנו 'בוצע' גם כאן", "לא נמחק ולא נוצר כלום; לא יישלח Push"],
  },
  // Calendar (the Owner's main calendar)
  {
    actionId: "CREATE_CALENDAR_EVENT", kinds: ["gcal-event"],
    meta: meta("CALENDAR", "יצירת אירוע ביומן (בלי מוזמנים)", "Create a Google Calendar event on the main calendar (no attendees)", [T("summary"), T("start"), T("end"), T("description", false), B("allDay")], ["summary", "start", "end"], "addCalendarEvent (lib/writes/calendar)", { effects: ["CALENDAR"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL", compensation: "delete the event (separate approved action)" }),
    createContext: eventDupContext,
    async resolve(d, a) { const s = text(a.summary, 200); if (s === null) return refuse("BAD_TEXT", "כותרת חסרה"); return { key: "gcal-event:new", id: "new", label: s.trim(), fields: await eventDupContext(d, a) }; },
    read: eventFields,
    plan(a, cur) {
      if (!cur.connected) return refuse("NOT_CONNECTED", "Google Calendar לא מחובר — צריך חיבור מחדש באפליקציה");
      const s = text(a.summary, 200); if (s === null) return refuse("BAD_TEXT", "כותרת חסרה");
      const allDay = a.allDay === true; const re = allDay ? /^\d{4}-\d{2}-\d{2}$/ : DT;
      if (!re.test(String(a.start)) || !re.test(String(a.end)) || String(a.end) <= String(a.start)) return refuse("BAD_TIME", allDay ? "תאריכים לא תקינים (YYYY-MM-DD, סוף אחרי התחלה)" : "זמנים לא תקינים (YYYY-MM-DDTHH:MM, סוף אחרי התחלה)");
      return { ok: true, after: { summary: s.trim(), start: String(a.start), end: String(a.end) } };
    },
    async apply(d, _id, a, args) { const allDay = args.allDay === true; return { createdId: await d.addCalendarEvent({ summary: String(a.summary), start: allDay ? String(a.start) : `${a.start}:00`, end: allDay ? String(a.end) : `${a.end}:00`, description: str(args.description), allDay }) }; },
    async verify(d, id, after) { const e = await d.readCalendarEvent(id); return !!e && e.summary === after.summary; },
    requiredValues: (_a, after) => [String(after.start)],
    warnings: eventDupWarnings,
    disclosuresHe: ["האירוע נוצר ביומן הראשי שלך בלבד — בלי מוזמנים ובלי הזמנות", "הוא לא מקושר לרשומה ב-Redbloods (סשן / פגישה / הופעה נוצרים דרך הפעולות שלהם)"],
  },
  {
    actionId: "CREATE_CALENDAR_INVITE", kinds: ["gcal-event"],
    meta: meta("CALENDAR", "אירוע ביומן עם הזמנה למוזמנים", "Create a calendar event and INVITE attendees (Google emails them)", [T("summary"), T("start"), T("end"), T("description", false), T("attendees")], ["summary", "start", "end", "attendees"], "addCalendarEvent with attendees (lib/writes/calendar)", { effects: ["CALENDAR", "EMAIL"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    createContext: eventDupContext,
    async resolve(d, a) { const s = text(a.summary, 200); if (s === null) return refuse("BAD_TEXT", "כותרת חסרה"); return { key: "gcal-event:new", id: "new", label: s.trim(), fields: await eventDupContext(d, a) }; },
    read: eventFields,
    plan(a, cur) {
      if (!cur.connected) return refuse("NOT_CONNECTED", "Google Calendar לא מחובר");
      const s = text(a.summary, 200); if (s === null) return refuse("BAD_TEXT", "כותרת חסרה");
      if (!DT.test(String(a.start)) || !DT.test(String(a.end)) || String(a.end) <= String(a.start)) return refuse("BAD_TIME", "זמנים לא תקינים (YYYY-MM-DDTHH:MM)");
      const emails = String(a.attendees ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      if (!emails.length || emails.length > 20 || emails.some((e) => !EMAIL.test(e))) return refuse("BAD_EMAIL", "רשימת מוזמנים לא תקינה");
      return { ok: true, after: { summary: s.trim(), start: String(a.start), end: String(a.end), attendees: emails.join(", ") } };
    },
    async apply(d, _id, a, args) { return { createdId: await d.addCalendarEvent({ summary: String(a.summary), start: `${a.start}:00`, end: `${a.end}:00`, description: str(args.description), attendees: String(a.attendees).split(", ") }) }; },
    async verify(d, id, after) { const e = await d.readCalendarEvent(id); return !!e && e.summary === after.summary; },
    requiredValues: (_a, after) => [String(after.start), ...String(after.attendees).split(", ")],
    warnings: eventDupWarnings,
    disclosuresHe: ["Google שולח הזמנה במייל לכל מוזמן — זו תקשורת חיצונית", "לא נשלח Push; האירוע לא מקושר לרשומה ב-Redbloods"],
  },
  {
    actionId: "UPDATE_CALENDAR_EVENT", kinds: ["gcal-event"],
    meta: meta("CALENDAR", "עדכון אירוע ביומן", "Update an event on the main calendar (title / time / place / description)", [K("event"), T("summary", false), T("start", false), T("end", false), T("location", false), T("description", false)], ["summary", "start", "end", "location", "description"], "editCalendarEvent (lib/writes/calendar)", { effects: ["CALENDAR"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    resolve: onEvent, read: eventFields,
    plan(a, cur) {
      const after: Fields = {};
      if (a.summary !== undefined) { const t = text(a.summary, 200); if (t === null) return refuse("BAD_TEXT", "כותרת לא תקינה"); after.summary = t.trim(); }
      for (const k of ["start", "end"] as const) if (a[k] !== undefined) { if (!DT.test(String(a[k]))) return refuse("BAD_TIME", "זמן לא תקין (YYYY-MM-DDTHH:MM)"); after[k] = String(a[k]); }
      for (const k of ["location", "description"] as const) if (a[k] !== undefined) { const t = text(a[k]); if (t === null) return refuse("BAD_TEXT", "ערך לא תקין"); after[k] = t; }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.editCalendarEvent(id, { ...(a.summary !== undefined ? { summary: String(a.summary) } : {}), ...(a.start !== undefined ? { startIso: `${a.start}:00` } : {}), ...(a.end !== undefined ? { endIso: `${a.end}:00` } : {}), ...(a.location !== undefined ? { location: String(a.location) } : {}), ...(a.description !== undefined ? { description: String(a.description) } : {}) }),
    async verify(d, id, after) { const e = await d.readCalendarEvent(id); return !!e && Object.entries(after).every(([k, v]) => (k === "start" || k === "end" ? String(e[k as "start"]).startsWith(String(v)) : e[k as keyof GEvent] === v)); },
    requiredValues: (_a, after) => [after.start, after.end].filter(Boolean).map(String),
    warnings: (c) => (Number(c.attendeeCount) > 0 ? [`לאירוע יש ${c.attendeeCount} מוזמנים — Google עשוי לעדכן אותם`] : []),
    disclosuresHe: ["רק האירוע ביומן הראשי משתנה — רשומת Redbloods קשורה (סשן / פגישה) לא משתנה", "אם באירוע יש מוזמנים — Google עשוי לעדכן אותם"],
  },
  {
    actionId: "DELETE_CALENDAR_EVENT", kinds: ["gcal-event"],
    meta: meta("CALENDAR", "מחיקת אירוע מהיומן", "Delete an event from the main calendar", [K("event")], ["exists"], "removeCalendarEvent (lib/writes/calendar)", { effects: ["CALENDAR", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onEvent(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const e = await d.readCalendarEvent(id); return e ? { ...e, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.removeCalendarEvent(id),
    async verify(d, id) { return (await d.readCalendarEvent(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["האירוע נמחק מהיומן הראשי; רשומת Redbloods קשורה (אם יש) לא נמחקת", "אם באירוע יש מוזמנים — Google עשוי להודיע להם על הביטול"],
  },
  {
    actionId: "CREATE_GOOGLE_TASK", kinds: ["gtask"],
    meta: meta("CALENDAR", "יצירת Google Task (לא משימה של Redbloods)", "Create a standalone Google Task", [T("title"), D("due", true), T("notes", false)], ["title", "due"], "addGoogleTask (lib/writes/calendar)", { effects: ["GOOGLE_TASKS"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "NO", compensation: null }),
    createContext: async (d) => ({ connected: await d.calendarConnected() }),
    async resolve(d, a) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "כותרת חסרה"); return { key: "gtask:new", id: "new", label: t.trim(), fields: { connected: await d.calendarConnected() } }; },
    read: async () => null,
    plan(a, cur) { if (!cur.connected) return refuse("NOT_CONNECTED", "Google לא מחובר"); const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "כותרת חסרה"); if (!realYmd(a.due)) return refuse("BAD_DATE", "תאריך לא תקין"); return { ok: true, after: { title: t.trim(), due: String(a.due) } }; },
    // the created Google Task id is returned (createdId → gtask:<id>) so the result names exactly what was made
    async apply(d, _id, a, args) { const id = await d.addGoogleTask(String(a.title), String(a.due), str(args.notes)); return { receipt: id, createdId: id }; },
    verify: async (_d, _id, _a, out) => typeof out.receipt === "string" && out.receipt.length > 0,
    requiredValues: (_a, after) => [String(after.due)],
    disclosuresHe: ["נוצר Google Task בלבד — לא משימה ב-Redbloods (למשימה משוקפת יש פעולת 'יצירת משימה')", "לא יישלח Push"],
  },
  {
    actionId: "DELETE_GOOGLE_TASK", kinds: ["gtask"],
    meta: meta("CALENDAR", "מחיקת Google Task שלא מקושר למשימה", "Delete a standalone Google Task (a task-linked one is deleted with its task)", [K("googleTask")], ["exists"], "removeGoogleTask (lib/writes/calendar)", { effects: ["GOOGLE_TASKS", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) {
      const m = typeof a.googleTask === "string" ? /^gtask:([A-Za-z0-9_-]{5,100})$/.exec(a.googleTask) : null;
      if (!m) return refuse("BAD_ENTITY", "צריך Google Task (gtask:…)");
      const g = await d.readGoogleTask(m[1]); if (!g) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ה-Google Task");
      return { key: `gtask:${m[1]}`, id: m[1], label: g.title || "Google Task", fields: { ...g, exists: true, linked: await d.googleTaskLinkedToTask(m[1]) } };
    },
    async read(d, id) { const g = await d.readGoogleTask(id); return g ? { ...g, exists: true, linked: await d.googleTaskLinkedToTask(id) } : null; },
    plan: (_a, cur) => (cur.linked ? refuse("USE_TASK_ACTION", "ה-Google Task הזה מקושר למשימה ב-Redbloods — מחיקת המשימה מוחקת גם אותו") : { ok: true, after: { exists: false } }),
    apply: (d, id) => d.removeGoogleTask(id),
    async verify(d, id) { return (await d.readGoogleTask(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["ה-Google Task נמחק לצמיתות; שום רשומה ב-Redbloods לא משתנה", "לא יישלח Push"],
  },
  {
    actionId: "DISCONNECT_GOOGLE_CALENDAR", kinds: ["system"],
    meta: meta("CALENDAR", "ניתוק Google Calendar + Tasks מ-Redbloods", "Disconnect the Google integration (revoke the stored token; the token itself is never exposed)", [], ["connected"], "revokeToken (lib/writes/calendar)", { effects: ["SETTINGS", "CALENDAR", "GOOGLE_TASKS"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: "the Boss reconnects Google in the app (OAuth consent is his, never Sunny's)" }),
    async resolve(d) { return { key: "system:google", id: "google", label: "Google Calendar + Tasks", fields: { connected: await d.calendarConnected() } }; },
    read: async (d) => ({ connected: await d.calendarConnected() }),
    plan: (_a, cur) => (cur.connected ? { ok: true, after: { connected: false } } : refuse("NO_CHANGE_NEEDED", "Google כבר לא מחובר")),
    apply: (d) => d.disconnectGoogle(),
    requiredValues: () => ["ניתוק"],
    warnings: () => ["אחרי הניתוק מפסיקים לעבוד: אירועי יומן לסשנים / פגישות / הופעות, סנכרון שעות מהיומן, Google Tasks, בדיקת זמינות — וגם הקריאה של סאני ליומן", "חיבור מחדש רק אתה, באפליקציה (אישור גוגל)"],
    disclosuresHe: ["הטוקן השמור נמחק מ-Redbloods (הוא לא מוצג לאף אחד); ההרשאה בחשבון גוגל עצמו נשארת עד שתבטל אותה שם", "אירועים ומשימות שכבר קיימים בגוגל לא נמחקים"],
  },
];
