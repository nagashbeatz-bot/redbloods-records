/**
 * Canonical cancelled-payment helper.
 *
 * A transaction whose payment_status is "בוטל" is CANCELLED — it counts as
 * NEITHER received income NOR expected/future income, anywhere in the system.
 * Received-income calcs already exclude it (they positively match the paid set,
 * which never contains "בוטל"). Expected/future-income calcs that were written as
 * "everything that isn't paid" must additionally exclude cancelled — use this
 * helper there instead of hard-coding the string, so the rule lives in one place.
 *
 * NOTE: this is deliberately a plain module (no "server-only") so it can be
 * imported from server code (reports, agent) and client components alike.
 */
export const CANCELLED_PAYMENT_STATUS = "בוטל";

/** True when a transaction's payment_status marks it as cancelled. */
export function isCancelledPayment(status: string | null | undefined): boolean {
  return (status ?? "") === CANCELLED_PAYMENT_STATUS;
}

/**
 * Canonical outstanding-balance formula — the single source of truth for
 * "how much is still owed against the agreed price". It removes BOTH money
 * already received AND income that was explicitly cancelled ("בוטל"), which is
 * written off and never collectible:
 *
 *     collectible = agreedPrice − receivedIncome − cancelledIncome
 *
 * where receivedIncome = only "שולם"/"התקבל", and cancelledIncome = only income
 * transactions with payment_status "בוטל" ("צפוי"/"לא שולם" are NOT cancelled).
 *
 * Returned SIGNED so callers can still detect overpayment (negative = paid over
 * the agreed price). Callers that display "outstanding to collect" clamp with
 * Math.max(0, …) exactly as they did before — the only change here is the extra
 * − cancelledIncome term. Never duplicate this subtraction inline; call this.
 */
export function collectibleBalance(agreedPrice: number, receivedIncome: number, cancelledIncome: number): number {
  return agreedPrice - receivedIncome - cancelledIncome;
}
