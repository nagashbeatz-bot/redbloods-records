/**
 * Redbloods Partner — Finance Owner questions taxonomy (F2.8–F2.10). Pure constants, no imports.
 *
 * The ONE source of truth for the structured finance questions the Owner can answer in
 * Partner → כסף → צריך ממך. They are persisted as ordinary Owner Context rows through the existing
 * append-only primitive (partner_owner_context), so they join the investigation taxonomy
 * (questions.ts ANSWER_OPTIONS) — the strict row parser then accepts exactly these codes.
 *
 * Unlike the Case questions, a finance question is NEVER given the generic OTHER option: each type lists
 * its complete answer set (OTHER only where the Owner approved it).
 *
 * Owner answers are OWNER KNOWLEDGE only: they never create, change or delete a transaction, a price,
 * a due date, a finance setting or a recurring-expense record.
 */
export const FINANCE_QUESTION_TYPES = [
  "FINANCE_RECURRING_PAYMENT_STATUS",
  "FINANCE_RECEIVABLE_TIMING",
  "FINANCE_COMPLETED_PROJECT_INCOME_STATUS",
  "FINANCE_ORPHAN_SETTING_MEANING",
  "FINANCE_EXPENSE_RECURRENCE",
  "FINANCE_OVERDUE_REASON",
] as const;
export type FinanceQuestionType = (typeof FINANCE_QUESTION_TYPES)[number];

export interface FinanceAnswerOption { code: string; labelHe: string }

export const FINANCE_ANSWER_OPTIONS: Record<FinanceQuestionType, readonly FinanceAnswerOption[]> = {
  FINANCE_RECURRING_PAYMENT_STATUS: [
    { code: "PAID_NEEDS_RECORDING", labelHe: "שולם — צריך לרשום בכספים" },
    { code: "NOT_PAID", labelHe: "עדיין לא שולם" },
    { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  // Owner COLLECTION INTENT — a window, never a fake exact date. EXACT_DATE is the only answer that carries a date.
  FINANCE_RECEIVABLE_TIMING: [
    { code: "THIS_WEEK", labelHe: "השבוע" },
    { code: "BY_MONTH_END", labelHe: "עד סוף החודש" },
    { code: "NEXT_MONTH", labelHe: "בחודש הבא" },
    { code: "EXACT_DATE", labelHe: "יש תאריך מדויק" },
    { code: "NOT_EXPECTED", labelHe: "לא צפוי להתקבל" },
    { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  FINANCE_COMPLETED_PROJECT_INCOME_STATUS: [
    { code: "INCOME_RECEIVED_NOT_RECORDED", labelHe: "ההכנסה התקבלה ולא נרשמה" },
    { code: "INCOME_NOT_RECEIVED", labelHe: "ההכנסה עדיין לא התקבלה" },
    { code: "NON_PAID_PROJECT", labelHe: "הפרויקט לא היה בתשלום" },
    { code: "OTHER", labelHe: "אחר" },
    { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  FINANCE_ORPHAN_SETTING_MEANING: [
    { code: "HISTORICAL_ONLY", labelHe: "נתון היסטורי בלבד" },
    { code: "REAL_DEAL_NEEDS_RECOVERY", labelHe: "עסקה אמיתית שצריך לשחזר" },
    { code: "UNKNOWN", labelHe: "לא יודע כרגע" },
  ],
  FINANCE_EXPENSE_RECURRENCE: [
    { code: "RECURRING", labelHe: "כן, הוצאה קבועה" },
    { code: "ONE_TIME", labelHe: "לא, חד-פעמית" },
    { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
  FINANCE_OVERDUE_REASON: [
    { code: "WAITING_FOR_CLIENT", labelHe: "מחכה ללקוח" },
    { code: "PROMISED_NEW_DATE", labelHe: "הבטיח תאריך חדש" },
    { code: "DISPUTE", labelHe: "יש מחלוקת" },
    { code: "WAITING_FOR_DELIVERY", labelHe: "מחכה למסירה" },
    { code: "OWNER_AGREED_DELAY", labelHe: "סיכמתי לדחות" },
    { code: "OTHER", labelHe: "אחר" },
    { code: "UNKNOWN", labelHe: "לא יודע" },
  ],
};

/** The only finance answer that carries a value (an explicit calendar date, never in the past). */
export const FINANCE_EXACT_DATE_ANSWERS: Partial<Record<FinanceQuestionType, string>> = { FINANCE_RECEIVABLE_TIMING: "EXACT_DATE" };

export const isFinanceQuestionType = (t: unknown): t is FinanceQuestionType =>
  typeof t === "string" && (FINANCE_QUESTION_TYPES as readonly string[]).includes(t);

/** Owner Context case ids of finance questions all start with this prefix (never a Partner Case id). */
export const FINANCE_CASE_PREFIX = "finance:";
