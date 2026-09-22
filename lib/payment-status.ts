/**
 * Canonical finance-semantics helpers — TWO DELIBERATELY SEPARATE CONCEPTS.
 *
 * Finance Semantics Unification (2026-09-22 audit + Owner decision): production
 * had ONE ambiguous helper (`collectibleBalance`, removed here) that mixed two
 * different questions into one number:
 *
 *   A. ACTUAL PAYMENT POSITION — the financial source of truth. "Was this
 *      project actually paid? How much of the agreed price was actually
 *      received? How much remains unpaid?" Depends ONLY on agreedPrice and
 *      paidIncome (שולם/התקבל). A cancelled ("בוטל") transaction can NEVER
 *      affect this — it is not money, it never was.
 *
 *   B. COLLECTION INTENT — a separate, operational question: "how much are
 *      we still actively planning to collect?" This CAN legitimately differ
 *      from (A) in exactly one situation the existing project-cancellation
 *      UX (components/ui/StatusDropdown.tsx) already creates: when a
 *      PROJECT's own status is moved to "בוטל" and the Owner explicitly
 *      chooses "בטל את היתרה" (cancel the balance), the app bulk-moves that
 *      project's still-expected (not yet received) income transactions to
 *      "בוטל" — a genuine, explicit write-off decision. If the Owner instead
 *      chooses "השאר את היתרה" (keep the balance), those transactions stay
 *      exactly as they were and nothing is written off.
 *
 * The audit (see git history around 2026-09-22) found production evidence of
 * a THIRD, unrelated usage of the same "בוטל" transaction status: an ad-hoc,
 * per-transaction cancellation via components/finance/QuickTxModal.tsx,
 * selectable on ANY transaction of ANY project regardless of the project's
 * own status, with no logged reason and no connection to the project-level
 * cancel-balance decision above. That usage carries NO proven write-off
 * intent. Treating it as one is what caused the original bug: a completed
 * project (agreedPrice=3200, received=1600, one ₪1600 line item separately
 * marked "בוטל") read as "fully paid" everywhere, hiding a real ₪1600 debt.
 *
 * Consequence: `collectibleAmount` below only nets out cancelled income when
 * the PROJECT ITSELF is formally cancelled (status "בוטל") — never for an
 * individually-cancelled transaction on an active or completed project. There
 * is no explicit write-off/waiver field in the schema (audited, confirmed
 * absent) — this is the best available signal, not a perfect reconstruction
 * of historical intent. A dedicated write-off model is a future DB decision,
 * out of scope here.
 *
 * NOTE: deliberately a plain module (no "server-only") so it can be imported
 * from server code (reports, agent) and client components alike.
 */

/** A transaction's payment_status value meaning "cancelled" — never money, never counted. */
export const CANCELLED_PAYMENT_STATUS = "בוטל";

/** True when a transaction's payment_status marks it as cancelled. */
export function isCancelledPayment(status: string | null | undefined): boolean {
  return (status ?? "") === CANCELLED_PAYMENT_STATUS;
}

/**
 * A PROJECT's own status value meaning "cancelled" — the same Hebrew string as
 * CANCELLED_PAYMENT_STATUS, but a different field on a different table
 * (projects.status vs transactions.payment_status). Named separately so the
 * two concepts are never confused at a call site.
 */
export const CANCELLED_PROJECT_STATUS = "בוטל";

/** True when a PROJECT's own status marks the project itself as cancelled. */
export function isProjectCancelled(projectStatus: string | null | undefined): boolean {
  return (projectStatus ?? "") === CANCELLED_PROJECT_STATUS;
}

// ── A. ACTUAL PAYMENT POSITION — the financial source of truth ───────────────
//
// All three take agreedPrice and paidIncome ONLY. paidIncome must already be
// the sum of income transactions with payment_status "שולם"/"התקבל" (never
// "בוטל", never "צפוי"/"לא שולם") — every caller already computes this via
// lib/finance/classify.ts's isReceivedStatus or an equivalent explicit check.

/**
 * Signed actual balance against the agreed price: positive = still owed,
 * negative = paid over the agreed price, zero = paid exactly. This is the
 * canonical truth — NEVER subtracts cancelled income.
 */
export function actualBalanceAgainstAgreedPrice(agreedPrice: number, paidIncome: number): number {
  return agreedPrice - paidIncome;
}

/** How much remains unpaid against the agreed price. Never negative. */
export function actualOutstandingAgainstAgreedPrice(agreedPrice: number, paidIncome: number): number {
  return Math.max(agreedPrice - paidIncome, 0);
}

/** How much was paid beyond the agreed price (credit/tip). Never negative. */
export function overpaymentAmount(agreedPrice: number, paidIncome: number): number {
  return Math.max(paidIncome - agreedPrice, 0);
}

/** paidIncome >= agreedPrice — the ONLY correct test for a "paid" / "שולם ✓" indicator. */
export function isFullyPaid(agreedPrice: number, paidIncome: number): boolean {
  return paidIncome >= agreedPrice;
}

// ── B. COLLECTION INTENT — a separate, narrower, deliberately scoped concept ──

/**
 * How much money is still actively intended to be collected. Equal to the
 * actual outstanding amount UNLESS the project itself is formally cancelled
 * (`projectStatus === CANCELLED_PROJECT_STATUS`), in which case cancelled
 * income (from the project's own "cancel the balance" choice — see module
 * doc) is netted out too. An individually-cancelled transaction on a
 * non-cancelled (active or completed) project never reduces this — it has
 * no proven write-off intent (module doc).
 */
export function collectibleAmount(
  agreedPrice: number,
  paidIncome: number,
  cancelledIncome: number,
  projectStatus: string | null | undefined,
): number {
  const outstanding = actualOutstandingAgainstAgreedPrice(agreedPrice, paidIncome);
  if (!isProjectCancelled(projectStatus)) return outstanding;
  return Math.max(outstanding - cancelledIncome, 0);
}
