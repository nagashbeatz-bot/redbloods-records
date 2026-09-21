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
 * Reuses the existing single-source helpers instead of redefining them:
 *   - CLIP_PAID_STATUSES (lib/clip-finance.ts — "same set used system-wide")
 *   - isCancelledPayment (lib/payment-status.ts)
 */
import { CLIP_PAID_STATUSES } from "../clip-finance";
import { isCancelledPayment, CANCELLED_PAYMENT_STATUS } from "../payment-status";

/** The statuses that count as money received / paid. */
export const RECEIVED_STATUSES: readonly string[] = CLIP_PAID_STATUSES;
const RECEIVED = new Set<string>(RECEIVED_STATUSES);

/** True when a payment_status means the money actually changed hands. */
export function isReceivedStatus(status: string | null | undefined): boolean {
  return RECEIVED.has(status ?? "");
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
