/**
 * SUNNY UNIVERSAL ACTION LAYER — Sessions family (studio sessions, mix cleanups, rehearsals, clip shoots; project or
 * standalone). Every write goes through lib/writes/sessions — the same writer the Schedule modal / drawer use.
 * Show rehearsals (type חזרה להופעה) carry finance + the show split (D6 vocabulary) and belong to the Shows family.
 */
import type { ArgSpec } from "../types";
import { COMMON_NO, finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

type Sess = { projectId: string | null; showId: string | null; title: string; date: string | null; startTime: string | null; endTime: string | null; status: string; sessionType: string; notes: string; location: string; photographer: string; hasCalendarEvent: boolean };
export interface SessionFamilyWriters {
  readSession(id: string): Promise<Sess | null>;
  countSessionTransactions(id: string): Promise<number>;
  isShalevProject(projectId: string): Promise<boolean>;
  createSession(s: { projectId: string | null; title: string | null; date: string; startTime: string; endTime: string | null; status: string; sessionType: string; notes: string; location: string; photographer: string; addToCalendar: boolean; invite: { emails: string[]; publicTitle: string; publicDescription?: string } | null; showId?: string | null; cost?: number | null; paymentStatus?: string }): Promise<{ id: string; calendarError: string | null }>;
  updateSession(id: string, patch: Record<string, unknown>): Promise<{ calendarSynced: boolean | null }>;
  deleteSession(id: string): Promise<{ calendarDeleted: boolean | null }>;
}

/** Pinned to components/ui/ProjectDrawer.tsx STATUS_OPTIONS / TYPE_OPTIONS by scripts/test-sunny-act-sessions.tsx. */
export const SESSION_STATUSES: readonly string[] = ["מתוכנן", "התקיים", "בוטל", "נדחה", "לא הגיע"];
export const SESSION_TYPES: readonly string[] = ["סשן", "ניקוי מיקס", "חזרה", "צילום קליפ"];
const REHEARSAL = "חזרה להופעה";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "PROJECT", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const SCHED_ARGS: readonly ArgSpec[] = [K("project", false), T("title"), { name: "date", kind: "ymd", required: true }, { name: "startTime", kind: "time", required: true }, { name: "endTime", kind: "time", required: false }, { name: "sessionType", kind: "enum", required: false, values: SESSION_TYPES }, { name: "status", kind: "enum", required: false, values: SESSION_STATUSES }, T("notes"), T("location"), T("photographer")];

// ── schedule (create) ────────────────────────────────────────────────────────────────────────────────────────────────
async function schedContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const k = parseKey(a.project, ["project"]);
  const p = k ? await d.readProjectMeta(k.id) : null;
  return { projectName: p ? p.name : null, shalevPush: k && p ? await d.isShalevProject(k.id) : false, connected: a.addToCalendar === true || a.inviteEmails !== undefined ? await d.calendarConnected() : null };
}
async function schedResolve(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  if (a.project !== undefined && !parseKey(a.project, ["project"])) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
  const c = await schedContext(d, a);
  if (a.project !== undefined && c.projectName === null) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  return { key: "session:new", id: "new", label: c.projectName ? `סשן — ${c.projectName}` : `סשן — ${String(a.title ?? "")}`, fields: c };
}
function schedPlan(a: Readonly<Record<string, unknown>>, cur: Fields): { ok: true; after: Fields } | PlanRefusal {
  if (a.project === undefined && text(a.title, 200) === null) return refuse("MISSING_TARGET", "צריך פרויקט או שם לסשן עצמאי");
  if (a.project !== undefined && a.title !== undefined) return refuse("BAD_ARGS", "סשן של פרויקט לא מקבל שם נפרד");
  if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין");
  if (!TIME.test(String(a.startTime))) return refuse("BAD_TIME", "שעת התחלה לא תקינה (HH:MM)");
  if (a.endTime !== undefined && !TIME.test(String(a.endTime))) return refuse("BAD_TIME", "שעת סיום לא תקינה (HH:MM)");
  const type = String(a.sessionType ?? "סשן");
  if (type === REHEARSAL) return refuse("USE_SHOW_ACTION", "חזרה להופעה נקבעת דרך פעולת החזרות של ההופעה (יש לה כספים)");
  if (!SESSION_TYPES.includes(type)) return refuse("BAD_ENUM", "סוג סשן לא מוכר");
  const status = String(a.status ?? "מתוכנן");
  if (!SESSION_STATUSES.includes(status)) return refuse("BAD_ENUM", "סטטוס סשן לא מוכר");
  for (const k of ["notes", "location", "photographer"]) if (a[k] !== undefined && text(a[k]) === null) return refuse("BAD_TEXT", `${k} לא תקין`);
  if (cur.connected === false) return refuse("NOT_CONNECTED", "Google Calendar לא מחובר — אפשר לקבוע בלי יומן, או לחבר מחדש באפליקציה");
  return { ok: true, after: { date: String(a.date), startTime: String(a.startTime), endTime: (a.endTime as string | undefined) ?? null, sessionType: type, status } };
}
const schedApply = (invite: boolean) => async (d: WriterDeps, _id: string, after: Fields, a: Readonly<Record<string, unknown>>) => {
  const emails = invite ? String(a.inviteEmails).split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [];
  const r = await d.createSession({
    projectId: parseKey(a.project, ["project"])?.id ?? null, title: str(a.title)?.trim() ?? null, date: String(after.date), startTime: String(after.startTime), endTime: (after.endTime as string | null) ?? null,
    status: String(after.status), sessionType: String(after.sessionType), notes: str(a.notes) ?? "", location: str(a.location) ?? "", photographer: str(a.photographer) ?? "",
    addToCalendar: a.addToCalendar === true, invite: invite ? { emails, publicTitle: String(a.publicTitle).trim(), publicDescription: str(a.publicDescription) } : null,
  });
  if ((a.addToCalendar === true || invite) && r.calendarError) return { createdId: r.id, receipt: `calendar: ${r.calendarError}` };
  return { createdId: r.id, receipt: null };
};
const schedVerify = async (d: WriterDeps, id: string, after: Fields, out: { receipt?: unknown }) => {
  const s = await d.readSession(id);
  return !!s && s.date === after.date && s.startTime === after.startTime && s.sessionType === after.sessionType && (out.receipt === null || out.receipt === undefined);
};
const pushWarning = (c: Fields) => (c.shalevPush ? ["הפרויקט של שליו טסמה — הוא ואתה תקבלו Push 'נקבע סשן' (כמו באפליקציה)"] : []);

export const SESSION_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "SCHEDULE_SESSION", kinds: ["session"],
    meta: meta("קביעת סשן (לפרויקט או עצמאי)", "Book a studio session / cleanup / rehearsal / shoot (optionally + a Google event, no guests)", [...SCHED_ARGS, { name: "addToCalendar", kind: "boolean", required: false }], ["date", "startTime", "endTime", "sessionType", "status"], "createSession (lib/writes/sessions)", { effects: ["CALENDAR", "PUSH"], riskClass: "EXTERNAL_SYSTEM_WRITE", reversible: "PARTIAL", compensation: "delete the session (separate approved action; its event is removed with it)" }),
    createContext: schedContext, resolve: schedResolve,
    read: async (d, id) => { const s = await d.readSession(id); return s ? { ...s } : null; },
    plan: schedPlan, apply: schedApply(false), verify: schedVerify,
    requiredValues: (_a, after) => [String(after.date), String(after.startTime)],
    warnings: pushWarning,
    disclosuresHe: ["נוצר סשן; אם ביקשת יומן — נוצר אירוע ביומן הראשי בלי מוזמנים", "תאריך ההתחלה של הפרויקט מתמלא אם הוא ריק (כמו באפליקציה)", "לא נוצרת רשומה כספית (תשלום צפוי לסשן הוא פעולה נפרדת)"],
  },
  {
    actionId: "SCHEDULE_SESSION_WITH_INVITE", kinds: ["session"],
    meta: meta("קביעת סשן + הזמנה ביומן לאמן", "Book a session and INVITE the artist on the calendar event (Google emails the guests)", [...SCHED_ARGS, T("inviteEmails", true), T("publicTitle", true), T("publicDescription")], ["date", "startTime", "endTime", "sessionType", "status"], "createSession with invite (lib/writes/sessions)", { effects: ["CALENDAR", "EMAIL", "PUSH"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    createContext: schedContext, resolve: schedResolve,
    read: async (d, id) => { const s = await d.readSession(id); return s ? { ...s } : null; },
    plan(a, cur) {
      const p = schedPlan(a, cur); if (!p.ok) return p;
      const emails = String(a.inviteEmails ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      if (!emails.length || emails.length > 10 || emails.some((e) => !EMAIL.test(e))) return refuse("BAD_EMAIL", "רשימת מוזמנים לא תקינה");
      if (text(a.publicTitle, 200) === null) return refuse("BAD_TEXT", "חסרה כותרת ציבורית (מה שהאמן יראה)");
      return { ok: true, after: { ...p.after, inviteEmails: emails.join(", "), publicTitle: String(a.publicTitle).trim() } };
    },
    apply: schedApply(true), verify: schedVerify,
    requiredValues: (_a, after) => [String(after.date), String(after.startTime), ...String(after.inviteEmails).split(", ")],
    warnings: pushWarning,
    disclosuresHe: ["Google שולח הזמנה במייל לכל מוזמן — עם הכותרת הציבורית שבתצוגה (לא השם הפנימי)", "נוצר סשן מקושר לאירוע", "לא נוצרת רשומה כספית"],
  },
  {
    actionId: "UPDATE_SESSION", kinds: ["session"],
    meta: meta("עדכון סשן (מועד / סטטוס / סוג / הערות / מקום / צלם)", "Update a session (its Google event follows a date / time change)", [K("session"), { name: "date", kind: "ymd", required: false }, { name: "startTime", kind: "time", required: false }, { name: "endTime", kind: "time", required: false }, { name: "status", kind: "enum", required: false, values: SESSION_STATUSES }, { name: "sessionType", kind: "enum", required: false, values: SESSION_TYPES }, T("notes"), T("location"), T("photographer")], ["date", "startTime", "endTime", "status", "sessionType", "notes", "location", "photographer"], "updateSession (lib/writes/sessions)", { effects: ["CALENDAR"], riskClass: "EXTERNAL_SYSTEM_WRITE" }),
    async resolve(d, a) {
      const k = parseKey(a.session, ["session"]); if (!k) return refuse("BAD_ENTITY", "צריך סשן (session:…)");
      const s = await d.readSession(k.id); if (!s) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הסשן");
      return { key: `session:${k.id}`, id: k.id, label: `${s.sessionType} ${s.date ?? ""} ${s.startTime ?? ""}`.trim(), fields: { ...s } };
    },
    read: async (d, id) => { const s = await d.readSession(id); return s ? { ...s } : null; },
    plan(a, cur) {
      if (cur.sessionType === REHEARSAL) return refuse("USE_SHOW_ACTION", "זו חזרה להופעה — עריכה דרך פעולת החזרות של ההופעה (יש לה כספים)");
      const after: Fields = {};
      if (a.date !== undefined) { if (!realYmd(a.date)) return refuse("BAD_DATE", "תאריך לא תקין"); after.date = String(a.date); }
      for (const k of ["startTime", "endTime"] as const) if (a[k] !== undefined) { if (!TIME.test(String(a[k]))) return refuse("BAD_TIME", "שעה לא תקינה"); after[k] = String(a[k]); }
      if (a.status !== undefined) { if (!SESSION_STATUSES.includes(String(a.status))) return refuse("BAD_ENUM", "סטטוס לא מוכר"); after.status = String(a.status); }
      if (a.sessionType !== undefined) { if (!SESSION_TYPES.includes(String(a.sessionType))) return refuse("BAD_ENUM", "סוג לא מוכר"); after.sessionType = String(a.sessionType); }
      for (const k of ["notes", "location", "photographer"] as const) if (a[k] !== undefined) { const t = text(a[k]); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t; }
      if ((after.startTime || after.date) && !(after.startTime ?? cur.startTime)) return refuse("BAD_TIME", "לסשן אין שעת התחלה — צריך לציין אותה");
      return finishPlan(cur, after);
    },
    apply: async (d, id, a) => { await d.updateSession(id, { ...a }); },
    requiredValues: (_a, after) => [after.date, after.startTime, after.endTime].filter((x) => x !== undefined && x !== null).map(String),
    warnings: (c) => (c.hasCalendarEvent ? [] : ["לסשן אין אירוע ביומן — רק הרשומה משתנה"]),
    disclosuresHe: ["אם לסשן יש אירוע ביומן — הוא זז לשעה / לתאריך החדשים (אם יש בו מוזמנים, הכותרת שלו נשמרת)", "שינוי סטטוס (גם 'בוטל') לא מוחק את האירוע ביומן — כמו באפליקציה", "לא יישלח Push; שום רשומה כספית לא משתנה"],
  },
  {
    actionId: "DELETE_SESSION", kinds: ["session"],
    meta: meta("מחיקת סשן", "Delete a session (and its Google event); a linked UNPAID expense is marked בוטל and kept as history; a paid / partly paid one refuses the delete", [K("session")], ["exists"], "deleteSession (lib/writes/sessions)", { effects: ["FINANCE", "CALENDAR", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) {
      const k = parseKey(a.session, ["session"]); if (!k) return refuse("BAD_ENTITY", "צריך סשן (session:…)");
      const s = await d.readSession(k.id); if (!s) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הסשן");
      return { key: `session:${k.id}`, id: k.id, label: `${s.sessionType} ${s.date ?? ""} ${s.startTime ?? ""}`.trim(), fields: { ...s, exists: true, linkedTransactions: await d.countSessionTransactions(k.id) } };
    },
    async read(d, id) { const s = await d.readSession(id); return s ? { ...s, exists: true, linkedTransactions: await d.countSessionTransactions(id) } : null; },
    plan: (_a, cur) => (cur.sessionType === REHEARSAL ? refuse("USE_SHOW_ACTION", "זו חזרה להופעה — מחיקה דרך פעולת החזרות של ההופעה (יש לה כספים)") : { ok: true, after: { exists: false } }),
    apply: async (d, id) => { await d.deleteSession(id); },
    async verify(d, id) { return (await d.readSession(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => (Number(c.linkedTransactions) > 0 ? [`${c.linkedTransactions} רשומות כספים מקושרות לסשן — הן נשארות (לא נמחקות)`] : []),
    disclosuresHe: ["הסשן נמחק לצמיתות, והאירוע שלו ביומן (אם יש) נמחק אחריו", ...COMMON_NO.slice(0, 1)],
  },
];
