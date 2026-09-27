/**
 * Transaction classification — the minimal, shared meaning of a transaction row.
 *
 * Deliberately a plain module (no "server-only") so client components and server
 * code import the same definitions.
 *
 * Business rules (Owner-confirmed):
 *   received  = "שולם" | "התקבל"                 — money that actually changed hands
 *   cancelled = "בוטל"                           — never counted anywhere
 *   NOT received = "צפוי" | "לא שולם" | "בוטל"
 *
 * Statuses that do not exist in production ("חלקי", "שולם חלקית", "לבדיקה",
 * "מקדמה") are intentionally given NO special behaviour here: they are simply not
 * "received". Existing per-surface handling of them is left exactly as it was.
 *
 * THIS FILE IS THE ONE STATUS RULE (Finance single truth, 2026-09-27): every other module
 * (clip-finance, shows-types, agent, health, stats, UI surfaces) imports these helpers instead of
 * restating a literal set. Reuses isCancelledPayment (lib/payment-status.ts).
 */
import { isCancelledPayment, CANCELLED_PAYMENT_STATUS } from "../payment-status";

/** The statuses that count as INCOME money received. */
export const RECEIVED_STATUSES = ["שולם", "התקבל"] as const;
const RECEIVED = new Set<string>(RECEIVED_STATUSES);

/**
 * Statuses that mean money is still EXPECTED (not received, not cancelled). "חלקי" is expected:
 * a partial row is never fully paid.
 */
export const EXPECTED_STATUSES = ["צפוי", "לא שולם", "חלקי"] as const;
const EXPECTED = new Set<string>(EXPECTED_STATUSES);

/** True when a payment_status means money is still expected (צפוי / לא שולם / חלקי). */
export function isExpectedStatus(status: string | null | undefined): boolean {
  return EXPECTED.has(status ?? "");
}

/** True when a payment_status means the money actually changed hands. */
export function isReceivedStatus(status: string | null | undefined): boolean {
  return RECEIVED.has(status ?? "");
}

/**
 * INCOME received (שולם | התקבל). Same rule as isReceivedStatus, named for the income side so
 * callers that classify both sides read unambiguously.
 */
export const isIncomeReceivedStatus = isReceivedStatus;

/** The ONLY status that means an EXPENSE was fully paid (Owner-confirmed Finance contract). */
export const EXPENSE_FULLY_PAID_STATUS = "שולם";

/**
 * EXPENSE fully paid: "שולם" ONLY. "חלקי" / "צפוי" / "לא שולם" / "בוטל" are not paid, and an
 * expense marked "התקבל" (an income status) is invalid / ambiguous data — never a paid expense.
 */
export function isExpenseFullyPaidStatus(status: string | null | undefined): boolean {
  return status === EXPENSE_FULLY_PAID_STATUS;
}

/** True when a payment_status is "בוטל" (re-exported so callers import one module). */
export const isCancelledStatus = isCancelledPayment;
export { CANCELLED_PAYMENT_STATUS };

/**
 * Income / expense by `transactions.type`. Every current writer stores exactly
 * "income" / "expense" and production holds no other value, so this is strict on
 * purpose — it matches what every Owner UI surface already did inline.
 */
export function isIncomeTx(tx: { type?: string | null }): boolean {
  return tx.type === "income";
}
export function isExpenseTx(tx: { type?: string | null }): boolean {
  return tx.type === "expense";
}

/**
 * The one "is this row actual money?" rule for BOTH sides: income counts when שולם | התקבל,
 * expense counts only when שולם (an expense "התקבל" is invalid data, never paid).
 */
export function isActualMoneyTx(tx: { type?: string | null; payment_status?: string | null }): boolean {
  if (tx.type === "income") return isReceivedStatus(tx.payment_status);
  if (tx.type === "expense") return isExpenseFullyPaidStatus(tx.payment_status);
  return false;
}
