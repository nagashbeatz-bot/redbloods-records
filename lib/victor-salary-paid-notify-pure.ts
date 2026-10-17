/**
 * "Your salary was paid" push to Victor — the PURE rules (no "server-only" / Supabase / push imports, so plain tsx tests
 * drive them). The server side lives in lib/victor-salary-paid-notify.ts.
 *
 * Owner spec 2026-10-17 (P_VICTOR_SALARY_PAID): when the Finance row of a salary month (linked_session_id
 * victor_salary_<YYYY-MM>) REALLY moves to שולם — from any writer — Victor gets ONE push per salary month, in his portal
 * language (en default / ru), with the month only (no amount: SG_VICTOR_SALARY_IN_PAYLOAD keeps salary out of his
 * surfaces); the Owner gets an ack only AFTER Victor's push was delivered. A month whose due date passed more than
 * VICTOR_SALARY_PUSH_MAX_LATE_DAYS ago (a historical back-fill) is never announced.
 */

/** The delivery-claim key per salary month (settings, PUSH_SENT_ONCE_MARKERS family — no schema change). */
export const VICTOR_SALARY_PAID_CLAIM_PREFIX = "victor_salary_paid_pushed_";
export const victorSalaryPaidClaimKey = (workMonth: string) => `${VICTOR_SALARY_PAID_CLAIM_PREFIX}${workMonth}`;
/** One claim version per month: a "sent" claim never re-sends (un-pay → pay again stays silent); a "failed" one may retry. */
export const VICTOR_SALARY_PAID_CLAIM_VERSION = "paid";

/** Victor's portal language as the server knows it (settings, written by his own portal ping). Victor's UI is en / ru only. */
export const VICTOR_PUSH_LANG_KEY = "victor_push_lang";
export type VictorPushLang = "en" | "ru";
export const normalizeVictorPushLang = (v: unknown): VictorPushLang => (v === "ru" ? "ru" : "en");

/** Owner spec default (open Owner decision): no push for a month whose due date passed more than this many days ago. */
export const VICTOR_SALARY_PUSH_MAX_LATE_DAYS = 45;

const SALARY_LINK_RE = /^victor_salary_(\d{4}-(?:0[1-9]|1[0-2]))$/;
/** The salary month of a Finance row, from its canonical business key (null = not a salary row). */
export function salaryMonthOfLinkedId(linkedSessionId: string | null | undefined): string | null {
  const m = SALARY_LINK_RE.exec((linkedSessionId ?? "").trim());
  return m ? m[1] : null;
}

/** A REAL transition: not paid → שולם. A save of an already-שולם row is NOT one. `before` null = the row was just created. */
export function isSalaryRealPaidTransition(before: string | null | undefined, after: string | null | undefined): boolean {
  return after === "שולם" && before !== "שולם";
}

/** Salary for work month M is due on the 10th of M+1 (the same rule as lib/victor-salary-format salaryDueDate). */
function dueDateOf(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-10`;
}
const dayNum = (ymd: string) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000);

export type VictorSalarySkipReason = "not_salary_row" | "not_expense" | "not_paid" | "historical_month";

/** Who may be told: a live salary expense row, שולם now, whose due date is not more than the window in the past. */
export function victorSalaryEligibility(i: { linkedSessionId: string | null | undefined; type: string | null | undefined; status: string | null | undefined; todayYmd: string; maxLateDays?: number }):
  { ok: true; workMonth: string } | { ok: false; reason: VictorSalarySkipReason; workMonth?: string } {
  const workMonth = salaryMonthOfLinkedId(i.linkedSessionId);
  if (!workMonth) return { ok: false, reason: "not_salary_row" };
  if (i.type !== "expense") return { ok: false, reason: "not_expense", workMonth };
  if (i.status !== "שולם") return { ok: false, reason: "not_paid", workMonth };
  const late = dayNum(i.todayYmd) - dayNum(dueDateOf(workMonth));
  if (late > (i.maxLateDays ?? VICTOR_SALARY_PUSH_MAX_LATE_DAYS)) return { ok: false, reason: "historical_month", workMonth };
  return { ok: true, workMonth };
}

const MONTHS: Record<VictorPushLang, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ru: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
};
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthYear = (workMonth: string, names: readonly string[]) => `${names[Number(workMonth.slice(5, 7)) - 1]} ${workMonth.slice(0, 4)}`;

/** Victor's push — the month only, never an amount or a status page (his portal shows no salary, on purpose). */
export function buildVictorSalaryPush(workMonth: string, lang: VictorPushLang): { title: string; body: string } {
  if (lang === "ru") return { title: "Зарплата выплачена", body: `Ваша зарплата за ${monthYear(workMonth, MONTHS.ru)} выплачена. Спасибо!` };
  return { title: "Salary paid", body: `Your salary for ${monthYear(workMonth, MONTHS.en)} has been paid. Thank you!` };
}

/** The preview line (Sunny's action layer) for a write that makes a salary row שולם: exactly what the notifier will do. */
/** Today in Israel (YYYY-MM-DD). */
export const israelTodayYmd = (nowMs = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));

export function victorSalaryPushPreviewHe(i: { linkedSessionId: string | null | undefined; type: string | null | undefined; before: string | null | undefined; todayYmd?: string }): string | null {
  if (!salaryMonthOfLinkedId(i.linkedSessionId) || i.type !== "expense") return null;
  if (!isSalaryRealPaidTransition(i.before, "שולם")) return "לא יישלח Push — המשכורת כבר מסומנת 'שולם'";
  const el = victorSalaryEligibility({ linkedSessionId: i.linkedSessionId, type: i.type, status: "שולם", todayYmd: i.todayYmd ?? israelTodayYmd() });
  if (!el.ok) return `לא יישלח Push לויקטור — מועד התשלום עבר לפני יותר מ-${VICTOR_SALARY_PUSH_MAX_LATE_DAYS} יום (רישום בדיעבד)`;
  return "יישלח Push לויקטור (\"המשכורת שולמה\", החודש בלבד, בלי סכום) — פעם אחת לחודש, רק אם יש לו מכשיר רשום. אחרי שהוא נמסר לו, גם אתה תקבל Push לטלפון: \"ויקטור עודכן ✓\"";
}

/**
 * What actually happened, from the month's delivery claim (the canonical evidence the notifier writes) — shown to Sunny
 * after an execution so she reports delivery from the record, never from the preview. null claim = no send was attempted.
 */
export function victorSalaryDeliveryHe(claim: unknown): { state: "DELIVERED" | "DELIVERED_NO_OWNER_ACK" | "NOT_DELIVERED" | "IN_PROGRESS" | "NOT_ATTEMPTED"; he: string } {
  const c = (claim && typeof claim === "object" ? claim : null) as { status?: string; result?: string; ownerAck?: string } | null;
  if (!c) return { state: "NOT_ATTEMPTED", he: "לא נרשם ניסיון שליחה לויקטור (אין מעבר אמיתי ל'שולם', רישום בדיעבד מעל 45 יום, או לא בסביבת production) — לא נשלח Push לאף אחד" };
  if (c.status === "processing") return { state: "IN_PROGRESS", he: "השליחה לויקטור עדיין בתהליך — עוד לא ידוע אם נמסרה" };
  if (c.status === "sent") {
    if (c.ownerAck === "sent") return { state: "DELIVERED", he: "ה-Push נמסר לויקטור, ואישור Push (\"ויקטור עודכן ✓\") נשלח לטלפון שלך" };
    if (c.ownerAck === "failed") return { state: "DELIVERED_NO_OWNER_ACK", he: "ה-Push נמסר לויקטור, אבל אישור ה-Push לטלפון שלך לא נמסר" };
    return { state: "DELIVERED", he: "ה-Push נמסר לויקטור (על האישור אליך אין רישום — כנראה נשלח קודם, לפני שהתחלנו לרשום אותו)" };
  }
  return { state: "NOT_DELIVERED", he: c.result === "no_subscription" ? "ה-Push לא נמסר — לויקטור אין מכשיר רשום להתראות. גם אליך לא נשלח אישור" : "ה-Push לויקטור לא נמסר (שגיאת שליחה). גם אליך לא נשלח אישור" };
}

/** The Owner's ack — sent ONLY after Victor's push was delivered. */
export function buildVictorSalaryOwnerAck(workMonth: string): { title: string; body: string } {
  return { title: "ויקטור עודכן ✓", body: `ויקטור קיבל עדכון שהמשכורת ל${monthYear(workMonth, HE_MONTHS)} שולמה.` };
}
