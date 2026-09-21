/**
 * Period income/expense stats, per currency.
 *
 * These are the SAME formulas the Finance page and the Insights page already
 * used inline — moved here verbatim so they can be run once per currency. The
 * ₪ figures are the headline (identical to the old output when every row is ₪);
 * any other currency is computed on its own and returned under `other`. Nothing
 * here converts or adds across currencies.
 */
import { DEFAULT_CURRENCY, groupByCurrency } from "./currency";
import { isExpenseTx, isIncomeTx } from "./classify";

export interface StatsTx {
  type: string;
  payment_status: string;
  amount: number;
  currency?: string | null;
  /** "project" | "general"; missing means "project" (Finance page rule). */
  scope?: string | null;
}

// ── Finance page formulas (calcStats) ─────────────────────────────────────────

export interface PeriodStats {
  incomeReceived: number;
  incomeExpected: number;
  projExpPaid: number;
  genExpPaid: number;
  expensesPaid: number;
  expensesExpected: number;
  profitReal: number;
  profitEst: number;
}

/** Finance page formulas, on rows that are already in ONE currency. */
export function calcStatsForRows(txList: readonly StatsTx[]): PeriodStats {
  const income          = txList.filter(isIncomeTx);
  const expenses        = txList.filter(isExpenseTx);
  const projectExpenses = expenses.filter((t) => (t.scope ?? "project") === "project");
  const generalExpenses = expenses.filter((t) => t.scope === "general");

  const incomeReceived    = income.filter((t) => ["התקבל", "שולם"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const incomeExpected    = income.filter((t) => ["צפוי", "חלקי", "לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const projExpPaid       = projectExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const genExpPaid        = generalExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesPaid      = projExpPaid + genExpPaid;
  const expensesExpected  = expenses.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal        = incomeReceived - expensesPaid;
  const profitEst         = incomeReceived + incomeExpected - expensesPaid - expensesExpected;
  return { incomeReceived, incomeExpected, projExpPaid, genExpPaid, expensesPaid, expensesExpected, profitReal, profitEst };
}

/** ₪ headline stats + a separate PeriodStats for every other currency present. */
export function calcPeriodStats(txList: readonly StatsTx[]): PeriodStats & { other: Record<string, PeriodStats> } {
  const groups = groupByCurrency(txList);
  const head = calcStatsForRows(groups.get(DEFAULT_CURRENCY) ?? []);
  const other: Record<string, PeriodStats> = {};
  for (const [cur, rows] of groups) if (cur !== DEFAULT_CURRENCY) other[cur] = calcStatsForRows(rows);
  return { ...head, other };
}

// ── Insights page formulas ────────────────────────────────────────────────────

export interface PeriodTotals {
  incomeReceived: number;
  incomeExpected: number;
  expensesPaid: number;
  expensesExpected: number;
  profitReal: number;
  profitEst: number;
}

/** Insights formulas, on rows that are already in ONE currency (no scope split). */
export function calcTotalsForRows(txList: readonly StatsTx[]): PeriodTotals {
  const periodIncome   = txList.filter(isIncomeTx);
  const periodExpenses = txList.filter(isExpenseTx);
  const incomeReceived   = periodIncome.filter((t) => ["שולם", "התקבל"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const incomeExpected   = periodIncome.filter((t) => ["צפוי", "חלקי", "לבדיקה"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const expensesPaid     = periodExpenses.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const expensesExpected = periodExpenses.filter((t) => ["צפוי", "לא שולם", "חלקי"].includes(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const profitReal       = incomeReceived - expensesPaid;
  const profitEst        = incomeReceived + incomeExpected - expensesPaid - expensesExpected;
  return { incomeReceived, incomeExpected, expensesPaid, expensesExpected, profitReal, profitEst };
}

/** ₪ headline totals + a separate PeriodTotals for every other currency present. */
export function calcPeriodTotals(txList: readonly StatsTx[]): PeriodTotals & { other: Record<string, PeriodTotals> } {
  const groups = groupByCurrency(txList);
  const head = calcTotalsForRows(groups.get(DEFAULT_CURRENCY) ?? []);
  const other: Record<string, PeriodTotals> = {};
  for (const [cur, rows] of groups) if (cur !== DEFAULT_CURRENCY) other[cur] = calcTotalsForRows(rows);
  return { ...head, other };
}
