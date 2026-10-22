/**
 * Sunny — WHAT HAPPENED ON A DAY (Owner request 2026-10-22, "מה קרה אתמול?"). Pure, read-only, no store, no write.
 *
 * Every time Redbloods keeps is labelled with WHAT KIND of time it is — and only a time of that kind places an event on a day:
 *   EVENT_TIME      the record of the act itself, stamped when it happened (a version upload, final files, notes sent to
 *                   Victor, a comment, an action Sunny executed after the Boss's approval)
 *   STATUS_CHANGED  a status change the app stamps SEPARATELY (a session's status_changed_at, a release stage / release,
 *                   a project's end date — stamped only on a real move into הושלם)
 *   RECORDED_AT     when a row was created (created_at) — the moment it was written, not necessarily when the thing happened
 *   ENTERED_DATE    a date a person typed / the app filled on the row (transaction date, payment date, session / show /
 *                   meeting date, due date) — a day only, never a moment, and never proof the row was written that day
 *   LAST_UPDATED    a generic updated_at — the LAST write to the row (any later edit moves it): an OBSERVATION, never the
 *                   payment time and never proof of a status change
 * Days are Israel days (a write at 00:40 Israel time belongs to that day, not to the evening before).
 * What Redbloods does NOT record is said, never guessed (NOT_RECORDED). Unread sources are UNKNOWN, never "nothing".
 */
import type { GatewaySources } from "../gateway/core";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { OperationsRaw } from "../operations/types";
import type { FinanceRaw } from "../finance/types";
import type { OwnerInboxItem } from "../../owner-inbox";
import type { ActionHistoryItem } from "./since";
import { isSocialItemOverdue, socialPhaseOf } from "@/lib/types";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const valid = (x: string | null | undefined): x is string => !!x && Number.isFinite(Date.parse(x));
const isYmd = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
export const ilYmd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const ilHm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const dm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
/** A timestamp with a time part → its Israel day; a bare YYYY-MM-DD → itself (a day-only stamp). */
const dayOfStamp = (x: string): string => (isYmd(x) ? x : ilYmd(x));
const money = (n: unknown, c: string | null) => { const v = Number(n); return Number.isFinite(v) ? `${c ?? ""}${v.toLocaleString("en-US")}` : `${c ?? ""}?`; };

export type TimeKind = "EVENT_TIME" | "STATUS_CHANGED" | "RECORDED_AT" | "ENTERED_DATE" | "LAST_UPDATED";
export const TIME_KIND_HE: Readonly<Record<TimeKind, string>> = {
  EVENT_TIME: "זמן הפעולה עצמה (נרשם כשזה קרה)",
  STATUS_CHANGED: "שינוי סטטוס שנרשם בנפרד",
  RECORDED_AT: "מתי השורה נוצרה במערכת",
  ENTERED_DATE: "תאריך שהוזן ברשומה (יום בלבד — לא הוכחה מתי נכתב)",
  LAST_UPDATED: "עודכן לאחרונה (כל עריכה מזיזה אותו — לא זמן תשלום ולא הוכחה לשינוי סטטוס)",
};

export interface DayEvent {
  day: string;
  /** the exact stamp (ISO) or null for a day-only value */
  at: string | null;
  /** HH:MM Israel when the stamp has a time */
  time: string | null;
  timeKind: TimeKind;
  kind: string;
  he: string;
  entity: string | null;
  /** the project the event belongs to (canonical id link only), for de-duplication against other answers */
  project?: string | null;
  source: string;
  epistemic: "FACT" | "OBSERVATION";
}
export interface DayActivity {
  day: string;
  /** what happened ON the day: EVENT_TIME / STATUS_CHANGED / RECORDED_AT stamped that day */
  happened: DayEvent[];
  /** dates typed / filled as this day (ENTERED_DATE) — a claim about the day, not the moment of writing */
  dated: DayEvent[];
  /** rows whose LAST write was that day — observations only (not "what changed") */
  lastUpdated: DayEvent[];
  /** what Redbloods does not record at all (said, never guessed) */
  notRecorded: string[];
  /** sources that could not be read (UNKNOWN — never "nothing happened") */
  unread: string[];
  actions: { status: "READ" | "NOT_READ"; count: number };
  summaryHe: string;
  timeKinds: Readonly<Record<TimeKind, string>>;
}

export const DAY_NOT_RECORDED_HE: readonly string[] = [
  "מתי תשלום סומן 'שולם' — לא נשמר (לא בעבודת מיקס ולא בשורת הכספים). יש רק את תאריך התשלום שהוזן ואת 'עודכן לאחרונה' של העבודה.",
  "מתי משימה סומנה 'בוצע' — לא נשמר.",
  "מתי סטטוס פרויקט השתנה — לא נשמר (חוץ מתאריך הסיום שנרשם במעבר אמיתי להושלם).",
  "תקשורת מחוץ למערכת (וואטסאפ / טלפון / מייל) — לא נראית.",
];

/** The one classification: an event belongs to the day only by a stamp of ITS OWN kind on that day. */
export function dayActivity(src: GatewaySources, day: string, actions?: readonly ActionHistoryItem[] | null): DayActivity {
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  const ops = ok(src.operations) as OperationsRaw | null;
  const fin = ok(src.finance)?.raw as FinanceRaw | undefined;
  const st = ok(src.state);
  const inbox = ok(src.ownerInbox) as OwnerInboxItem[] | null;
  const unread: string[] = [];
  if (!det) unread.push("פרטי הפרויקטים (גרסאות, הערות, סשנים, משימות, ויקטור, מסירות)");
  if (!fin) unread.push("הכספים");
  if (!ops) unread.push("התפעול (סושיאל, סיום פרויקטים)");

  const projectName = (id: string | null | undefined) => (id ? st?.domains.projects.data?.index?.[id]?.name ?? null : null);
  const all: DayEvent[] = [];
  const stamp = (at: string | null | undefined, timeKind: Exclude<TimeKind, "ENTERED_DATE">, kind: string, he: string, entity: string | null, source: string) => {
    if (!valid(at) && !isYmd(at)) return;
    const d = dayOfStamp(at!);
    if (d !== day) return;
    all.push({ day: d, at: isYmd(at) ? null : at!, time: isYmd(at) ? null : ilHm(at!), timeKind, kind, he, entity, source, epistemic: timeKind === "LAST_UPDATED" ? "OBSERVATION" : "FACT" });
  };
  const dated = (ymd: string | null | undefined, kind: string, he: string, entity: string | null, source: string) => {
    if (!isYmd(ymd) || ymd !== day) return;
    all.push({ day, at: null, time: null, timeKind: "ENTERED_DATE", kind, he, entity, source, epistemic: "FACT" });
  };

  if (det) {
    const works = det.engineerWork?.rows ?? [];
    const work = new Map(works.map((w) => [w.id, w]));
    const workTitle = (id: string | null) => { const w = id ? work.get(id) : undefined; return w ? ((w.workTitle ?? "").trim() || projectName(w.projectId) || "עבודת מיקס") : "עבודת מיקס"; };
    for (const v of det.mixVersions?.rows ?? []) {
      const w = v.workId ? work.get(v.workId) : undefined;
      stamp(v.uploadedAt ?? v.createdAt, "EVENT_TIME", "MIX_VERSION", `${w?.engineerName ?? "המהנדס"} העלה גרסה${v.label ? ` (${v.label})` : ""} ל"${workTitle(v.workId)}"`, v.workId ? `mix-work:${v.workId}` : null, "MIX_VERSIONS");
    }
    const commentsByWork = new Map<string, number>();
    const versionWork = new Map((det.mixVersions?.rows ?? []).map((v) => [v.id, v.workId]));
    for (const c of det.mixComments?.rows ?? []) {
      if (!valid(c.createdAt) || ilYmd(c.createdAt) !== day) continue;
      const wid = (c.versionId ? versionWork.get(c.versionId) : null) ?? "?";
      commentsByWork.set(wid, (commentsByWork.get(wid) ?? 0) + 1);
    }
    for (const [wid, n] of commentsByWork) {
      const firstAt = (det.mixComments?.rows ?? []).filter((c) => valid(c.createdAt) && ilYmd(c.createdAt) === day && (c.versionId ? versionWork.get(c.versionId) : "?") === wid).map((c) => c.createdAt!).sort()[0];
      stamp(firstAt, "EVENT_TIME", "MIX_COMMENTS", `${n === 1 ? "נכתבה הערה" : `נכתבו ${n} הערות`} על גרסה של "${workTitle(wid === "?" ? null : wid)}"`, wid !== "?" ? `mix-work:${wid}` : null, "MIX_COMMENTS");
    }
    for (const f of det.finalFiles?.rows ?? []) stamp(f.createdAt, "EVENT_TIME", "FINAL_FILES", `הועלו קבצים סופיים ל"${f.workId ? workTitle(f.workId) : projectName(f.projectId) ?? "פרויקט"}"`, f.projectId ? `project:${f.projectId}` : null, "FINAL_FILES");
    for (const w of works) {
      const title = workTitle(w.id), key = `mix-work:${w.id}`;
      stamp(w.createdAt, "RECORDED_AT", "ENGINEER_WORK_CREATED", `נפתחה עבודת ${w.workType ?? "מיקס"} ל-${w.engineerName ?? "מהנדס"}: "${title}"`, key, "ENGINEER_WORK");
      if ((w.amountPaid ?? 0) > 0) dated(w.paymentDate, "ENGINEER_PAYMENT_DATE", `תשלום ל-${w.engineerName ?? "מהנדס"} על "${title}" ${money(w.amountPaid, w.currency ?? "$")} — תאריך התשלום שהוזן ${dm(day)} (מתי סומן 'שולם' — לא נרשם)`, key, "ENGINEER_WORK");
      stamp(w.updatedAt, "LAST_UPDATED", "ENGINEER_WORK_UPDATED", `עבודת המיקס "${title}" (${w.engineerName ?? "מהנדס"}) עודכנה לאחרונה — עריכה כלשהי; לא בהכרח רגע סימון התשלום`, key, "ENGINEER_WORK");
    }
    for (const v of det.victor?.rows ?? []) {
      const title = (v.title ?? "").trim() || projectName(v.projectId) || "עבודה של ויקטור", key = `victor-work:${v.id}`;
      for (const f of v.filesReceived ?? []) stamp(f.uploadedAt, "EVENT_TIME", "VICTOR_UPLOAD", `ויקטור העלה קובץ ל"${title}"${f.versionLabel ? ` (${f.versionLabel})` : ""}`, key, "VICTOR");
      for (const r of v.reviews ?? []) if (!r.draft) stamp(r.sentAt, "EVENT_TIME", "VICTOR_NOTES", `נשלחו לויקטור הערות על "${title}" (${r.version})`, key, "VICTOR");
      stamp(v.createdAt, "RECORDED_AT", "VICTOR_WORK_CREATED", `נפתחה עבודה לויקטור: "${title}"`, key, "VICTOR");
    }
    for (const s of det.sessions?.rows ?? []) {
      const label = `${s.type ?? "סשן"}${s.projectId && projectName(s.projectId) ? ` ב"${projectName(s.projectId)}"` : ""}`;
      dated(s.date, "SESSION_DATE", `${label} — רשום לתאריך הזה${s.startTime ? ` ${s.startTime.slice(0, 5)}` : ""} · סטטוס ${s.status ?? "?"}${s.statusSource === "AUTO_MARK" ? " (סומן אוטומטית כשהזמן עבר — לא אישור שלך)" : s.statusSource === "MANUAL" ? " (סומן על ידך)" : ""}`, `session:${s.id}`, "SESSIONS");
      stamp(s.statusChangedAt, "STATUS_CHANGED", "SESSION_STATUS", `${label} (${s.date ? dm(s.date) : "?"}) — הסטטוס שונה ל-${s.status ?? "?"}${s.statusSource === "AUTO_MARK" ? " אוטומטית (לא אישור שלך)" : ""}`, `session:${s.id}`, "SESSIONS");
      stamp(s.createdAt, "RECORDED_AT", "SESSION_CREATED", `נקבע / נרשם ${label} ל-${s.date ? dm(s.date) : "?"}`, `session:${s.id}`, "SESSIONS");
    }
    for (const m of det.meetings?.rows ?? []) {
      dated(m.date, "MEETING_DATE", `פגישה${m.clientName ? ` עם ${m.clientName}` : ""} — רשומה לתאריך הזה · סטטוס ${m.status ?? "?"}`, `meeting:${m.id}`, "MEETINGS");
      stamp(m.createdAt, "RECORDED_AT", "MEETING_CREATED", `נקבעה פגישה${m.clientName ? ` עם ${m.clientName}` : ""} ל-${m.date ? dm(m.date) : "?"}`, `meeting:${m.id}`, "MEETINGS");
    }
    for (const t of det.tasks?.rows ?? []) {
      stamp(t.createdAt, "RECORDED_AT", "TASK_CREATED", `נוצרה משימה: "${t.title ?? ""}"`, `task:${t.id}`, "TASKS");
      if (t.status === "פתוח") dated(t.dueDate, "TASK_DUE", `משימה עם יעד ליום הזה, עדיין פתוחה: "${t.title ?? ""}"`, `task:${t.id}`, "TASKS");
      stamp(t.updatedAt, "LAST_UPDATED", "TASK_UPDATED", `המשימה "${t.title ?? ""}" עודכנה לאחרונה (סטטוס עכשיו: ${t.status ?? "?"}) — מתי סומנה בוצע לא נרשם`, `task:${t.id}`, "TASKS");
    }
    for (const d of det.deliveries?.rows ?? []) stamp(d.lastDeliveredAt ?? d.deliveredAt, "STATUS_CHANGED", "DELIVERED", `"${projectName(d.projectId) ?? "פרויקט"}" סומן כנמסר ללקוח`, `project:${d.projectId}`, "DELIVERIES");
    for (const r of det.releases?.rows ?? []) {
      stamp(r.releasedAt, "STATUS_CHANGED", "RELEASED", `הריליס של "${projectName(r.projectId) ?? "פרויקט"}" יצא`, `project:${r.projectId}`, "RELEASES");
      if (r.stageEnteredAt !== r.releasedAt) stamp(r.stageEnteredAt, "STATUS_CHANGED", "RELEASE_STAGE", `הריליס של "${projectName(r.projectId) ?? "פרויקט"}" עבר שלב`, `project:${r.projectId}`, "RELEASES");
    }
    for (const a of det.actions?.rows ?? []) stamp(a.createdAt, "RECORDED_AT", "SEND_LOG", `נרשם ביומן השליחות של "${projectName(a.projectId) ?? "פרויקט"}": ${a.actionType ?? ""}${a.contentType ? ` ${a.contentType}` : ""}${a.recipientRole ? ` → ${a.recipientRole}` : ""}`, a.projectId ? `project:${a.projectId}` : null, "PROJECT_ACTIONS");
  }

  if (fin) {
    const text = new Map((det?.transactionsText?.rows ?? []).map((t) => [t.id, t.description]));
    for (const t of fin.transactions) {
      const typeHe = t.type === "income" ? "הכנסה" : t.type === "expense" ? "הוצאה" : "תנועה";
      const desc = text.get(t.id) ?? t.description ?? t.category ?? "";
      const what = `${typeHe} ${money(t.amount, t.currency)}${desc ? ` · ${desc}` : ""}${projectName(t.projectId) ? ` · ${projectName(t.projectId)}` : ""} (סטטוס עכשיו: ${t.status ?? "?"})`;
      const createdDay = valid(t.createdAt) ? ilYmd(t.createdAt) : null;
      stamp(t.createdAt, "RECORDED_AT", "TRANSACTION_CREATED", `נרשמה בכספים ${what}${t.date && t.date !== createdDay ? ` — עם תאריך ${dm(t.date)}` : ""}`, `transaction:${t.id}`, "FINANCE");
      dated(t.date, "TRANSACTION_DATE", `${what} — התאריך ברשומה ${dm(day)}${createdDay && createdDay !== day ? ` (השורה נוצרה ב-${dm(createdDay)})` : ""}; מתי הסטטוס שונה — לא נרשם`, `transaction:${t.id}`, "FINANCE");
    }
    for (const s of fin.shows) dated(s.date, "SHOW_DATE", `הופעה${s.name ? ` "${s.name}"` : ""} — רשומה לתאריך הזה · סטטוס ${s.status ?? "?"}`, `show:${s.id}`, "SHOWS");
  }

  if (ops) {
    for (const p of ops.projectsMeta?.rows ?? []) if (p.status === "הושלם") dated(p.endDate, "PROJECT_COMPLETED", `"${p.name}" עבר להושלם (תאריך הסיום נרשם במעבר להושלם)`, `project:${p.id}`, "PROJECTS");
    for (const i of ops.contentItems?.rows ?? []) {
      const title = i.title ?? i.contentType ?? "תוכן";
      if (socialPhaseOf(i.status) === "PUBLISHED") dated(i.publishDate, "SOCIAL_PUBLISHED", `סושיאל: "${title}" — תאריך פרסום ${dm(day)}`, i.id ? `social-content:${i.id}` : null, "SOCIAL");
      else if (i.dueDate === day && isSocialItemOverdue({ status: i.status, due_date: i.dueDate }, addDay(day))) dated(i.dueDate, "SOCIAL_MISSED", `סושיאל: "${title}" היה מתוכנן ליום הזה ולא סומן כפורסם`, i.id ? `social-content:${i.id}` : null, "SOCIAL");
    }
  }
  // the project of each event — only through the record's own project id (never a name)
  const projectOfWork = new Map((det?.engineerWork?.rows ?? []).map((w) => [`mix-work:${w.id}`, w.projectId]));
  for (const v of det?.victor?.rows ?? []) projectOfWork.set(`victor-work:${v.id}`, v.projectId);
  for (const e of all) e.project = e.entity?.startsWith("project:") ? e.entity : e.entity && projectOfWork.get(e.entity) ? `project:${projectOfWork.get(e.entity)}` : null;
  for (const n of inbox ?? []) stamp(n.createdAt, "RECORDED_AT", "OWNER_UPDATE", `כתבת לסאני: «${n.body.slice(0, 60)}»`, `owner-inbox:${n.id}`, "OWNER_INBOX");

  return finishDay(day, all, unread, actions ?? null);
}

const addDay = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** Sunny's own executed actions on the day (the Action Layer history — the connector supplies it). */
export function actionDayEvents(actions: readonly ActionHistoryItem[], day: string): DayEvent[] {
  const out: DayEvent[] = [];
  for (const it of actions) {
    if (!valid(it.at) || ilYmd(it.at) !== day || (it.outcome !== "EXECUTED" && it.outcome !== "PARTIALLY_APPLIED")) continue;
    const steps = it.steps.filter((s) => s.outcome === "APPLIED_AS_EXPECTED").map((s) => s.actionId);
    if (!steps.length) continue;
    out.push({ day, at: it.at, time: ilHm(it.at), timeKind: "EVENT_TIME", kind: "SUNNY_ACTION", he: `סאני ביצעה באישורך: ${steps.join(", ")} (${it.planId})`, entity: it.steps[0]?.entity ?? null, source: "ACTIONS", epistemic: "FACT" });
  }
  return out;
}

const ORDER: readonly TimeKind[] = ["EVENT_TIME", "STATUS_CHANGED", "RECORDED_AT", "ENTERED_DATE", "LAST_UPDATED"];
/** Assemble + summarize (also re-run by the connector once the action history is known). */
export function finishDay(day: string, events: readonly DayEvent[], unread: readonly string[], actions: readonly ActionHistoryItem[] | null): DayActivity {
  const all = [...events.filter((e) => e.kind !== "SUNNY_ACTION"), ...(actions ? actionDayEvents(actions, day) : [])];
  const byTime = (a: DayEvent, b: DayEvent) => (a.at ?? "").localeCompare(b.at ?? "") || ORDER.indexOf(a.timeKind) - ORDER.indexOf(b.timeKind);
  const happened = all.filter((e) => e.timeKind === "EVENT_TIME" || e.timeKind === "STATUS_CHANGED" || e.timeKind === "RECORDED_AT").sort(byTime);
  const datedRows = all.filter((e) => e.timeKind === "ENTERED_DATE");
  // a row already told as "happened" (created that day) is not repeated as a typed date of the same day
  const told = new Set(happened.map((e) => e.entity).filter(Boolean));
  const dated = datedRows.filter((e) => !(e.kind === "TRANSACTION_DATE" && e.entity && told.has(e.entity)));
  const lastUpdated = all.filter((e) => e.timeKind === "LAST_UPDATED" && !(e.entity && happened.some((h) => h.entity === e.entity && h.kind.endsWith("_CREATED")))).sort(byTime);
  const progress = happened.filter((e) => ["MIX_VERSION", "FINAL_FILES", "VICTOR_UPLOAD", "VICTOR_NOTES", "MIX_COMMENTS", "DELIVERED", "RELEASED", "RELEASE_STAGE", "SESSION_STATUS"].includes(e.kind));
  const parts = [
    progress.length ? `התרחש (לפי זמן הפעולה): ${progress.slice(0, 4).map((e) => `${e.he}${e.time ? ` ${e.time}` : ""}`).join(" · ")}${progress.length > 4 ? ` ועוד ${progress.length - 4}` : ""}` : "לא נרשמה פעולת עבודה (גרסה / הערות / קבצים / מסירה) עם זמן מהיום הזה",
    happened.length > progress.length ? `נרשם במערכת ביום הזה: ${happened.length - progress.length} שורות (סשנים / משימות / כספים / פגישות שנוצרו)` : null,
    dated.length ? `${dated.length} רשומות נושאות את התאריך הזה כתאריך שהוזן — זה לא אומר שנכתבו או קרו בו` : null,
    unread.length ? `לא נקרא: ${unread.join(", ")} — לא ידוע, לא 'כלום'` : null,
    actions ? null : "הפעולות שסאני ביצעה לא נבדקו כאן",
  ].filter(Boolean);
  return { day, happened, dated, lastUpdated, notRecorded: [...DAY_NOT_RECORDED_HE], unread: [...unread], actions: { status: actions ? "READ" : "NOT_READ", count: actions ? happened.filter((e) => e.kind === "SUNNY_ACTION").length : 0 }, summaryHe: parts.join(". ") + ".", timeKinds: TIME_KIND_HE };
}

/** Work progress kinds (what moved the work itself) — the "new since yesterday" line uses only these. */
export const PROGRESS_DAY_KINDS: readonly string[] = ["MIX_VERSION", "FINAL_FILES", "VICTOR_UPLOAD", "DELIVERED", "RELEASED", "RELEASE_STAGE"];

/** Yesterday in Israel for a given instant. */
export function israelYesterday(now: Date): string { const d = new Date(`${ilYmd(now.toISOString())}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
