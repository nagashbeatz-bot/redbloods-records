/**
 * SUNNY UNIVERSAL ACTION LAYER — the Owner's company-level operations: his notification bell, business goals (KPIs,
 * never a pay rule), agent-alert handling (context only; the kill-switch rule is reused), the report schedule and a
 * report sent now, the Dropbox disconnect and the maintenance lock. Writes go through lib/writes/system. No credential
 * ever reaches a plan; reconnecting an integration stays the Boss's own consent flow.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, refuse, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export interface SystemFamilyWriters {
  readOwnerNotification(id: string): Promise<{ title: string | null; readAt: string | null } | null>;
  listOwnerUnread(): Promise<Array<{ id: string; title: string | null; createdAt: string | null }>>;
  countOwnerUnread(): Promise<number>;
  markOwnerNotificationRead(id: string): Promise<void>;
  markAllOwnerNotificationsRead(): Promise<number>;
  readBusinessGoals(): Promise<Record<string, { target: number; currency?: string }>>;
  setBusinessGoal(name: string, value: { target: number; currency?: string }): Promise<void>;
  readAlert(id: string): Promise<{ type: string; status: string; title: string } | null>;
  alertActionable(type: string): Promise<boolean>;
  setAlertStatus(id: string, status: string): Promise<void>;
  readReportSchedule(): Promise<{ morningTime: string | null; eveningTime: string | null }>;
  setReportSchedule(morningTime: string, eveningTime: string): Promise<void>;
  reportEmailConfigured(): Promise<boolean>;
  sendReportNow(kind: string): Promise<{ subject: string }>;
  fileStorageConnected(): Promise<boolean>;
  disconnectFileStorage(): Promise<void>;
  readMaintenance(): Promise<boolean>;
  setMaintenance(enabled: boolean): Promise<void>;
}
/** Pinned to lib/writes/system + lib/agent/goals + the alert route by the family test. */
export const GOAL_NAME_VALUES: readonly string[] = ["monthlyRevenue", "weeklySessions", "monthlyVictor", "monthlyCompletions"];
export const ALERT_STATUS_VALUES: readonly string[] = ["new", "handled", "dismissed", "ignored"];
const REPORT_KINDS = ["morning", "evening", "weekly"] as const;
const REPORT_HE: Record<string, string> = { morning: "דוח בוקר", evening: "דוח ערב", weekly: "דוח שבועי" };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const K = (name: string): ArgSpec => ({ name, kind: "entityKey", required: true });
const meta = (domain: string, he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain, he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });
const sys = (id: string, label: string, fields: Fields): ResolvedTarget => ({ key: `system:${id}`, id, label, fields });

async function onNotification(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const choices = async () => { const u = await d.listOwnerUnread(); return u.length ? ` — ההתראות שלך שלא נקראו (notification:id — כותרת): ${u.slice(0, 30).map((x) => `notification:${x.id} — ${(x.title ?? "").slice(0, 60)}`).join("; ")}` : " — אין התראות שלא נקראו"; };
  const k = parseKey(a.notification, ["notification"]); if (!k) return refuse("BAD_ENTITY", `צריך התראה (notification:…)${await choices()}`);
  const n = await d.readOwnerNotification(k.id); if (!n) return refuse("ENTITY_NOT_FOUND", `לא מצאתי התראה שלך במזהה הזה${await choices()}`);
  return { key: `notification:${k.id}`, id: k.id, label: n.title ?? "התראה", fields: { read: !!n.readAt } };
}
async function onAlert(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.alert, ["agent-alert"]); if (!k) return refuse("BAD_ENTITY", "צריך התראת סוכן (agent-alert:…)");
  const r = await d.readAlert(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההתראה");
  return { key: `agent-alert:${k.id}`, id: k.id, label: r.title || r.type, fields: { type: r.type, status: r.status, actionable: await d.alertActionable(r.type) } };
}

export const SYSTEM_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "MARK_NOTIFICATIONS_READ", kinds: ["notification"],
    meta: meta("NOTIFY", "סימון התראה שלך כנקראה", "Mark one of the Boss's own bell notifications read (recipient-bound; never another user's)", [K("notification")], ["read"], "markOwnerNotificationRead (lib/writes/system)", { reversible: "NO", compensation: null }),
    resolve: onNotification, read: async (d, id) => { const n = await d.readOwnerNotification(id); return n ? { read: !!n.readAt } : null; },
    plan: (_a, cur) => finishPlan(cur, { read: true }),
    apply: (d, id) => d.markOwnerNotificationRead(id),
    disclosuresHe: ["רק התראה שלך; של משתמש אחר — אף פעם", "לא נשלח כלום"],
  },
  {
    actionId: "MARK_ALL_NOTIFICATIONS_READ", kinds: ["system"],
    meta: meta("NOTIFY", "סימון כל ההתראות שלך כנקראו", "Mark ALL of the Boss's unread bell notifications read (bulk; the count is confirmed)", [], ["unread"], "markAllOwnerNotificationsRead (lib/writes/system)", { riskClass: "BULK", reversible: "NO", compensation: null }),
    async resolve(d) { return sys("bell", "הפעמון שלך", { unread: await d.countOwnerUnread() }); },
    read: async (d) => ({ unread: await d.countOwnerUnread() }),
    plan: (_a, cur) => (Number(cur.unread) > 0 ? { ok: true, after: { unread: 0 } } : refuse("NO_CHANGE_NEEDED", "אין התראות שלא נקראו")),
    async apply(d) { return { receipt: `${await d.markAllOwnerNotificationsRead()} סומנו` }; },
    requiredValues: () => ["כל ההתראות"],
    warnings: (c) => [`${c.unread} התראות יסומנו כנקראו (רק שלך)`],
    disclosuresHe: ["רק ההתראות שלך; לא נשלח כלום"],
  },
  {
    actionId: "SET_BUSINESS_GOAL", kinds: ["system"],
    meta: meta("AGENT", "עדכון יעד עסקי (KPI)", "Set one business goal target (monthly revenue ₪ / $, weekly sessions, monthly Victor works, monthly completions) — a KPI, never a pay rule", [{ name: "goal", kind: "enum", required: true, values: GOAL_NAME_VALUES }, { name: "target", kind: "number", required: true }, { name: "currency", kind: "enum", required: false, values: ["₪", "$"] }], ["target", "currency"], "setBusinessGoal (lib/writes/system)", { effects: ["SETTINGS"], riskClass: "NORMAL_BUSINESS" }),
    async resolve(d, a) { if (!GOAL_NAME_VALUES.includes(String(a.goal))) return refuse("BAD_ARGS", "יעד לא מוכר"); const g = (await d.readBusinessGoals())[String(a.goal)]; return sys(`goal-${a.goal}`, `יעד ${a.goal}`, { target: g?.target ?? 0, currency: g?.currency ?? null }); },
    async read(d, id) { const g = (await d.readBusinessGoals())[id.replace(/^goal-/, "")]; return { target: g?.target ?? 0, currency: g?.currency ?? null }; },
    plan(a, cur) {
      const t = Number(a.target); if (!Number.isFinite(t) || t < 0) return refuse("BAD_NUMBER", "יעד ≥ 0");
      if (a.goal === "monthlyRevenue") return finishPlan(cur, { target: t, currency: String(a.currency ?? cur.currency ?? "₪") });
      if (a.currency !== undefined) return refuse("BAD_ARGS", "מטבע רק ליעד ההכנסות");
      return finishPlan(cur, { target: t });
    },
    apply: (d, id, after) => d.setBusinessGoal(id.replace(/^goal-/, ""), { target: Number(after.target), ...(after.currency ? { currency: String(after.currency) } : {}) }),
    disclosuresHe: ["יעד = מדד, לא כלל תשלום ולא ציון", "הכנסות: $ ו-₪ לא מחוברים"],
  },
  {
    actionId: "MARK_AGENT_ALERT_HANDLED", kinds: ["agent-alert"],
    meta: meta("AGENT", "סימון התראת סוכן (טופלה / נדחתה / התעלם / חדשה)", "Set an agent alert's status — while alert rules are off only the exempt week-strength alert can be acted on (the route's rule, reused)", [K("alert"), { name: "status", kind: "enum", required: true, values: ALERT_STATUS_VALUES }], ["status"], "setAlertStatus (lib/writes/system)", {}),
    resolve: onAlert, read: async (d, id) => { const r = await d.readAlert(id); return r ? { type: r.type, status: r.status, actionable: await d.alertActionable(r.type) } : null; },
    plan: (a, cur) => (cur.actionable ? finishPlan(cur, { status: String(a.status) }) : refuse("FROZEN", "כללי התראות הסוכן כבויים — רק התראת 'שבוע חלש' ניתנת לסימון (הכלל של האפליקציה)")),
    async apply(d, id, after) { const r = await d.readAlert(id); if (!r || !(await d.alertActionable(r.type))) throw new Error("alert frozen by the kill-switch"); await d.setAlertStatus(id, String(after.status)); },
    disclosuresHe: ["התראות הסוכן הן הקשר בלבד — הסימון לא משנה שום רשומה עסקית", "כל עוד כללי ההתראות כבויים — רק התראת 'שבוע חלש' ניתנת לסימון"],
  },
  {
    actionId: "SET_REPORT_SCHEDULE", kinds: ["system"],
    meta: meta("REPORTS", "שינוי שעות דוחות המייל (בוקר / ערב)", "Change the morning / evening report email times (settings + the running schedule)", [{ name: "morningTime", kind: "time", required: true }, { name: "eveningTime", kind: "time", required: true }], ["morningTime", "eveningTime"], "setReportSchedule (lib/writes/system)", { effects: ["SETTINGS"], riskClass: "NORMAL_BUSINESS" }),
    async resolve(d) { const s = await d.readReportSchedule(); return sys("report-schedule", "שעות הדוחות", { morningTime: s.morningTime, eveningTime: s.eveningTime }); },
    read: async (d) => { const s = await d.readReportSchedule(); return { morningTime: s.morningTime, eveningTime: s.eveningTime }; },
    plan(a, cur) { if (!TIME_RE.test(String(a.morningTime)) || !TIME_RE.test(String(a.eveningTime))) return refuse("BAD_TIME", "שעה HH:MM"); return finishPlan(cur, { morningTime: String(a.morningTime), eveningTime: String(a.eveningTime) }); },
    apply: (d, _id, after) => d.setReportSchedule(String(after.morningTime), String(after.eveningTime)),
    disclosuresHe: ["רק השעות משתנות; הנמען והתוכן לא", "הדוח השבועי לא מושפע"],
  },
  {
    actionId: "SEND_REPORT_NOW", kinds: ["system"],
    meta: meta("REPORTS", "שליחת דוח מייל עכשיו (בוקר / ערב / שבועי)", "Generate and email a report now to the configured report address — the setup page's 'send now'", [{ name: "report", kind: "enum", required: true, values: REPORT_KINDS }], ["sent"], "sendReportNow (lib/writes/system)", { effects: ["EMAIL"], riskClass: "EXTERNAL_COMMUNICATION", reversible: "NO", compensation: null }),
    async resolve(d, a) { if (!(REPORT_KINDS as readonly string[]).includes(String(a.report))) return refuse("BAD_ARGS", "בוקר / ערב / שבועי"); if (!(await d.reportEmailConfigured())) return refuse("NOT_CONFIGURED", "שליחת מייל לא מוגדרת בשרת"); return sys(`report-${a.report}`, REPORT_HE[String(a.report)], { sent: false, emailConfigured: true }); },
    read: async (d) => ({ sent: false, emailConfigured: await d.reportEmailConfigured() }),
    plan: () => ({ ok: true, after: { sent: true } }),
    async apply(d, id) { return { receipt: (await d.sendReportNow(id.replace(/^report-/, ""))).subject }; },
    async verify() { return true; },
    requiredValues: (a) => [REPORT_HE[String(a.report)] ?? ""],
    disclosuresHe: ["נשלח מייל לכתובת הדוחות שמוגדרת בשרת (שלך) — לא ללקוח ולא לאף אחד אחר", "לוח הזמנים האוטומטי לא משתנה", "מייל שנשלח לא ניתן להחזיר"],
  },
  {
    actionId: "DISCONNECT_DROPBOX", kinds: ["system"],
    meta: meta("FILES", "ניתוק Dropbox מ-Redbloods", "Disconnect the Dropbox integration (revoke + remove the stored token; the token itself is never exposed)", [], ["connected"], "disconnectDropbox (lib/writes/system)", { effects: ["SETTINGS", "FILES"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: "the Boss reconnects Dropbox in the app (the OAuth consent is his, never Sunny's)" }),
    async resolve(d) { return sys("file-storage", "Dropbox", { connected: await d.fileStorageConnected() }); },
    read: async (d) => ({ connected: await d.fileStorageConnected() }),
    plan: (_a, cur) => (cur.connected ? { ok: true, after: { connected: false } } : refuse("NO_CHANGE_NEEDED", "Dropbox כבר לא מחובר")),
    apply: (d) => d.disconnectFileStorage(),
    requiredValues: () => ["ניתוק"],
    warnings: () => ["אחרי הניתוק מפסיקים לעבוד: העלאות והורדות של קבצים, תיקיות פרויקטים ומסירה, פורטלי אמנים (סקיצות / ביטים), קבצי מיקס וויקטור, קבצי סושיאל ו-Red Films", "חיבור מחדש רק אתה, באפליקציה"],
    disclosuresHe: ["הקבצים עצמם ב-Dropbox לא נמחקים", "הטוקן לא מוצג לאף אחד"],
  },
  {
    actionId: "SET_MAINTENANCE_MODE", kinds: ["system"],
    meta: meta("SYSTEM", "מצב תחזוקה (נעילת המערכת לכל מי שאינו אתה)", "Turn the maintenance lock on / off — on locks every non-Owner user out (Steven, Victor, artists, DJ)", [{ name: "enabled", kind: "boolean", required: true }], ["enabled"], "setMaintenanceChecked (lib/writes/system)", { effects: ["SETTINGS"], riskClass: "BULK", compensation: "a new approved plan with the opposite value" }),
    async resolve(d) { return sys("maintenance", "מצב תחזוקה", { enabled: await d.readMaintenance() }); },
    read: async (d) => ({ enabled: await d.readMaintenance() }),
    plan: (a, cur) => (typeof a.enabled !== "boolean" ? refuse("BAD_ARGS", "enabled = true / false") : finishPlan(cur, { enabled: a.enabled })),
    apply: (d, _id, after) => d.setMaintenance(after.enabled === true),
    requiredValues: (a) => [a.enabled === true ? "נעילה" : "פתיחה"],
    warnings: (c) => [c.enabled ? "המערכת נפתחת שוב לכל המשתמשים" : "כל מי שאינו אתה ננעל מחוץ למערכת עד שתפתח (סטיבן, ויקטור, אמנים, DJ)"],
    disclosuresHe: ["אתה תמיד נשאר בפנים", "לא נשלח Push / מייל"],
  },
];
