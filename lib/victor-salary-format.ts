/**
 * Victor salary — canonical, PURE formatting shared by the Finance writer (POST /api/vendor/victor/salary,
 * via lib/vendor-store re-exports) and Partner finance readiness. One definition, so a future Partner
 * execution writes exactly the row shape the canonical writer writes. No I/O, no "server-only".
 */
import { isExpenseFullyPaidStatus } from "./finance/classify";

const HE_MONTHS_SALARY = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

/** The canonical per-period business key stored in transactions.linked_session_id. */
export function salaryLinkedId(workMonth: string): string {
  return `victor_salary_${workMonth}`;
}

/** Salary for work month M is due on the 10th of month M+1. */
export function salaryDueDate(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  const dueYear = m === 12 ? y + 1 : y;
  const dueMon  = m === 12 ? 1 : m + 1;
  return `${dueYear}-${String(dueMon).padStart(2, "0")}-10`;
}

export function salaryMonthLabel(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  return `${HE_MONTHS_SALARY[m - 1]} ${y}`;
}

/** The canonical Finance transaction description for a Victor salary period. */
export function salaryTransactionDescription(workMonth: string): string {
  return `משכורת Victor — ${salaryMonthLabel(workMonth)}`;
}

// ── Month resolution (B5, 2026-09-27) — Finance precedence ───────────────────────────────────────────────────────
/**
 * THE salary-month rule (pure): a LIVE Finance row (linked_session_id victor_salary_<month>, not בוטל) decides
 * paid / amount / currency. The Owner's statements (amount override, status override) only FILL a month that has no
 * live Finance row; when both exist and disagree the month carries a `conflict` (the UI shows Finance AND "הצהרת
 * בעלים", nothing is silently merged). Two live rows for one month are a DUPLICATE conflict — never a silent pick.
 * A salary month is paid only when its Finance row is שולם (an expense; התקבל is income-only).
 */
export interface SalaryTxLite { id: string; paymentStatus: string | null; amount: number | null; currency: string | null }
export type SalaryMonthStatus = "צפוי" | "לא שולם" | "נשלח לכספים" | "שולם" | "חלקי" | "בוטל";
export interface SalaryConflict {
  kind: "OWNER_STATEMENT_DISAGREES" | "DUPLICATE_FINANCE_ROWS";
  he: string;
  finance: Array<{ id: string; paymentStatus: string | null; amount: number | null; currency: string | null }>;
  owner: { amount: number | null; status: string | null } | null;
}
export interface ResolvedSalaryMonth {
  amount: number; currency: string; status: SalaryMonthStatus;
  source: "FINANCE" | "OWNER_STATEMENT" | "CONFIGURED_DEFAULT";
  transactionId: string | null; transactionPaymentStatus: string | null;
  conflict: SalaryConflict | null;
}
const CANCELLED = "בוטל";
// Finance contract: an EXPENSE is fully paid ONLY when "שולם" (isExpenseFullyPaidStatus); "התקבל" is income-only.
const financeStatusOf = (ps: string | null): SalaryMonthStatus => (isExpenseFullyPaidStatus(ps) ? "שולם" : ps === "חלקי" ? "חלקי" : "נשלח לכספים");

export function resolveSalaryMonth(i: {
  dueDate: string; todayYmd: string; defaultAmount: number; defaultCurrency: string;
  amountOverride?: number | null; statusOverride?: string | null; txs: readonly SalaryTxLite[];
}): ResolvedSalaryMonth {
  const live = i.txs.filter((t) => (t.paymentStatus ?? "") !== CANCELLED).slice().sort((a, b) => a.id.localeCompare(b.id));
  const cancelled = i.txs.find((t) => (t.paymentStatus ?? "") === CANCELLED) ?? null;
  const ownerAmount = typeof i.amountOverride === "number" && Number.isFinite(i.amountOverride) ? i.amountOverride : null;
  const ownerStatus = i.statusOverride ? String(i.statusOverride) : null;
  const owner = ownerAmount !== null || ownerStatus !== null ? { amount: ownerAmount, status: ownerStatus } : null;
  const cur = (c: string | null) => ((c ?? "").trim() ? String(c).trim() : i.defaultCurrency);
  const fin = (t: SalaryTxLite) => ({ id: t.id, paymentStatus: t.paymentStatus, amount: t.amount, currency: t.currency });

  if (live.length > 1) {
    const allPaid = live.every((t) => isExpenseFullyPaidStatus(t.paymentStatus));
    const t0 = live[0];
    return {
      amount: t0.amount ?? ownerAmount ?? i.defaultAmount, currency: cur(t0.currency),
      // never claim paid unless EVERY duplicate row is שולם
      status: allPaid ? "שולם" : "נשלח לכספים", source: "FINANCE",
      transactionId: t0.id, transactionPaymentStatus: t0.paymentStatus,
      conflict: { kind: "DUPLICATE_FINANCE_ROWS", he: `${live.length} שורות כספים חיות לאותו חודש משכורת — צריך להחליט איזו נכונה (לא נבחרה אחת בשקט).`, finance: live.map(fin), owner },
    };
  }
  if (live.length === 1) {
    const t = live[0];
    const status = financeStatusOf(t.paymentStatus);
    const amount = t.amount ?? ownerAmount ?? i.defaultAmount;
    const disagree: string[] = [];
    if (ownerAmount !== null && t.amount !== null && Math.abs(ownerAmount - t.amount) > 0.001) disagree.push(`סכום: כספים ${t.amount} · הצהרת בעלים ${ownerAmount}`);
    if (ownerStatus !== null && ownerStatus !== status) disagree.push(`סטטוס: כספים ${status} · הצהרת בעלים ${ownerStatus}`);
    return {
      amount, currency: cur(t.currency), status, source: "FINANCE", transactionId: t.id, transactionPaymentStatus: t.paymentStatus,
      conflict: disagree.length ? { kind: "OWNER_STATEMENT_DISAGREES", he: `שורת הכספים קובעת; הצהרת הבעלים שונה — ${disagree.join("; ")}.`, finance: [fin(t)], owner } : null,
    };
  }
  // no live Finance row: the Owner's statement fills the month; else the configured salary + the due-date rule
  const status: SalaryMonthStatus = (ownerStatus as SalaryMonthStatus | null) ?? (i.dueDate <= i.todayYmd ? "לא שולם" : "צפוי");
  return {
    amount: ownerAmount ?? i.defaultAmount, currency: i.defaultCurrency, status,
    source: owner ? "OWNER_STATEMENT" : "CONFIGURED_DEFAULT",
    transactionId: cancelled?.id ?? null, transactionPaymentStatus: cancelled?.paymentStatus ?? null, conflict: null,
  };
}
