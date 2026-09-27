/**
 * Clip-deal finance — the single source of truth for "which money belongs to the
 * CLIP deal and not to the song deal".
 *
 * A clip payment is a REAL system transaction (type="income", scope="project",
 * project_id = the song's project) marked with expense_scope = "קליפ". There is
 * no second payments table — the קליפ tab summarises these very transactions.
 * This mirrors what Shows already does for its income rows
 * (lib/shows-finance-sync.ts writes expense_scope="הופעה" on income).
 *
 * WHY THE SEPARATION MATTERS: the song's balance is `agreedPrice − received`.
 * If clip income were counted as "received" against the song's agreedPrice, a
 * fully-paid song would show up as "שולם ביתר" the moment the artist pays for a
 * clip. Every place that compares project income against agreedPrice therefore
 * filters with `isSongIncome`, and the clip tab uses `summarizeClipFinance`.
 *
 * Deliberately a plain module (no "server-only") so both server routes and
 * client components can import it.
 */
import { isCancelledPayment } from "./payment-status";
import { RECEIVED_STATUSES, EXPECTED_STATUSES, isReceivedStatus, isExpectedStatus } from "./finance/classify";
import { normalizeCurrency } from "./finance/currency";

/** expense_scope marker for everything that belongs to the clip deal. */
export const CLIP_SCOPE = "קליפ";

/** Statuses that mean money actually changed hands — the canonical set of lib/finance/classify.ts. */
export const CLIP_PAID_STATUSES = RECEIVED_STATUSES;
/** Statuses that mean money is still expected (never counted as received) — lib/finance/classify.ts. */
export const CLIP_EXPECTED_STATUSES = EXPECTED_STATUSES;
/** Statuses offered on a clip payment — the existing Finance income statuses. */
export const CLIP_PAYMENT_STATUSES = ["התקבל", "שולם", "צפוי", "לא שולם", "בוטל"] as const;

/** Minimal transaction shape these helpers need — works on API rows and UI rows. */
export interface ClipTxLike {
  type?: string | null;
  amount?: number | null;
  payment_status?: string | null;
  expense_scope?: string | null;
  /** The row's own currency. Blank / null normalizes to ₪ (normalizeCurrency). */
  currency?: string | null;
}

const isIncomeType = (t: string | null | undefined) => t === "income" || t === "הכנסה";

/** True for any transaction (income or expense) tagged to the clip deal. */
export function isClipScoped(tx: { expense_scope?: string | null }): boolean {
  return (tx.expense_scope ?? "") === CLIP_SCOPE;
}

/** True for clip-deal INCOME — the rows the קליפ tab manages. */
export function isClipIncome(tx: ClipTxLike): boolean {
  return isIncomeType(tx.type) && isClipScoped(tx);
}

/**
 * True for income that belongs to the SONG deal — i.e. everything that should be
 * measured against the project's agreedPrice. Use this wherever a project's
 * received / expected / cancelled income is aggregated.
 */
export function isSongIncome(tx: ClipTxLike): boolean {
  return isIncomeType(tx.type) && !isClipScoped(tx);
}

/**
 * True when a Red Films production was CREATED by its linked project's "שלח קליפ" (provenance only).
 *
 * B3 (Owner canon 2026-09-27): the client clip price (A) is never the production's planned budget (B). There is no
 * price → budget sync and no budget lock any more: every production — created by "שלח קליפ" or legacy — owns its own
 * planning budget and currency. This reads the provenance flag the SERVER computes (lib/clip-production.ts
 * isManagedClipProduction, from the project's finance-settings marker) — never derived from the row's own columns.
 */
export function isCreatedBySendClip(prod: {
  budget_managed_by_project?: boolean | null;
}): boolean {
  return prod.budget_managed_by_project === true;
}

/** Shown on a production created by "שלח קליפ" — provenance, never a lock. */
export const SEND_CLIP_PROVENANCE_NOTE = "נוצרה מהפרויקט ('שלח קליפ') — התקציב הוא תכנון של ההפקה, לא מחיר הקליפ ללקוח";

export type ClipDealStatus = "אין עסקה" | "ממתין" | "חלקי" | "שולם" | "יתרת זכות";

export interface ClipFinanceSummary {
  /** The clip DEAL currency every amount below is in. Rows of any other currency are in `otherCurrency`. */
  currency: string;
  agreed: number;      // מחיר שסוכם עם האמן עבור הקליפ
  paid: number;        // התקבל בפועל (שולם / התקבל)
  expected: number;    // צפוי (צפוי / לא שולם / חלקי)
  cancelled: number;   // בוטל — written off, never collectible
  remaining: number;   // יתרה לתשלום — never negative
  credit: number;      // יתרת זכות (overpayment), 0 when not overpaid
  status: ClipDealStatus;
  count: number;       // number of clip payments
  paidCount: number;   // how many of them actually came in
  /**
   * Clip rows in a currency OTHER than the deal currency — never added to the deal math (no FX).
   * Per currency: received / expected sums and row count.
   */
  otherCurrency: Record<string, { paid: number; expected: number; count: number }>;
}

/**
 * Canonical clip-deal math. `remaining` is clamped at 0 — an overpayment is
 * reported as `credit` (יתרת זכות) instead of a negative debt, matching how the
 * rest of the system treats "שולם ביתר".
 *
 * CURRENCY (Finance single truth, 2026-09-27): the deal currency is REQUIRED. Only clip rows in
 * that currency count against the agreed clip price; every other currency is reported separately
 * in `otherCurrency` and never summed with it (no silent FX). It is impossible to mix.
 */
export function summarizeClipFinance(txs: ClipTxLike[], agreedClipPrice: number, dealCurrency: string | null | undefined): ClipFinanceSummary {
  const currency = normalizeCurrency(dealCurrency);
  const allClip = txs.filter(isClipIncome);
  const clip = allClip.filter((t) => normalizeCurrency(t.currency) === currency);
  const sum = (list: ClipTxLike[]) => list.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const otherCurrency: ClipFinanceSummary["otherCurrency"] = {};
  for (const t of allClip) {
    const c = normalizeCurrency(t.currency);
    if (c === currency) continue;
    const b = (otherCurrency[c] ??= { paid: 0, expected: 0, count: 0 });
    b.count++;
    if (isReceivedStatus(t.payment_status)) b.paid += Number(t.amount) || 0;
    else if (isExpectedStatus(t.payment_status)) b.expected += Number(t.amount) || 0;
  }

  const paid      = sum(clip.filter((t) => isReceivedStatus(t.payment_status)));
  const expected  = sum(clip.filter((t) => isExpectedStatus(t.payment_status)));
  const cancelled = sum(clip.filter((t) => isCancelledPayment(t.payment_status)));
  const agreed    = Number(agreedClipPrice) || 0;

  const signed    = agreed - paid;
  const remaining = Math.max(0, signed);
  const credit    = Math.max(0, -signed);

  let status: ClipDealStatus;
  if (agreed <= 0 && clip.length === 0) status = "אין עסקה";
  else if (credit > 0)                  status = "יתרת זכות";
  else if (agreed > 0 && remaining <= 0) status = "שולם";
  else if (paid > 0)                    status = "חלקי";
  else                                  status = "ממתין";

  return {
    currency, agreed, paid, expected, cancelled, remaining, credit, status,
    count: clip.length,
    paidCount: clip.filter((t) => isReceivedStatus(t.payment_status)).length,
    otherCurrency,
  };
}

/** Colour for a clip deal status badge — matches the palette used across the OS. */
export function clipStatusColor(status: ClipDealStatus): string {
  switch (status) {
    case "שולם":       return "#22C55E";
    case "חלקי":       return "#F59E0B";
    case "יתרת זכות":  return "#3B82F6";
    case "ממתין":      return "#F59E0B";
    default:            return "#6B7280";
  }
}
