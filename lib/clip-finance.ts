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

/** expense_scope marker for everything that belongs to the clip deal. */
export const CLIP_SCOPE = "קליפ";

/** Statuses that mean money actually changed hands. Same set used system-wide. */
export const CLIP_PAID_STATUSES = ["שולם", "התקבל"] as const;
/** Statuses that mean money is still expected (never counted as received). */
export const CLIP_EXPECTED_STATUSES = ["צפוי", "לא שולם", "חלקי"] as const;
/** Statuses offered on a clip payment — the existing Finance income statuses. */
export const CLIP_PAYMENT_STATUSES = ["התקבל", "שולם", "צפוי", "לא שולם", "בוטל"] as const;

const PAID_SET     = new Set<string>(CLIP_PAID_STATUSES);
const EXPECTED_SET = new Set<string>(CLIP_EXPECTED_STATUSES);

/** Minimal transaction shape these helpers need — works on API rows and UI rows. */
export interface ClipTxLike {
  type?: string | null;
  amount?: number | null;
  payment_status?: string | null;
  expense_scope?: string | null;
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

export type ClipDealStatus = "אין עסקה" | "ממתין" | "חלקי" | "שולם" | "יתרת זכות";

export interface ClipFinanceSummary {
  agreed: number;      // מחיר שסוכם עם האמן עבור הקליפ
  paid: number;        // התקבל בפועל (שולם / התקבל)
  expected: number;    // צפוי (צפוי / לא שולם / חלקי)
  cancelled: number;   // בוטל — written off, never collectible
  remaining: number;   // יתרה לתשלום — never negative
  credit: number;      // יתרת זכות (overpayment), 0 when not overpaid
  status: ClipDealStatus;
  count: number;       // number of clip payments
  paidCount: number;   // how many of them actually came in
}

/**
 * Canonical clip-deal math. `remaining` is clamped at 0 — an overpayment is
 * reported as `credit` (יתרת זכות) instead of a negative debt, matching how the
 * rest of the system treats "שולם ביתר".
 */
export function summarizeClipFinance(txs: ClipTxLike[], agreedClipPrice: number): ClipFinanceSummary {
  const clip = txs.filter(isClipIncome);
  const sum = (list: ClipTxLike[]) => list.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const paid      = sum(clip.filter((t) => PAID_SET.has(t.payment_status ?? "")));
  const expected  = sum(clip.filter((t) => EXPECTED_SET.has(t.payment_status ?? "")));
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
    agreed, paid, expected, cancelled, remaining, credit, status,
    count: clip.length,
    paidCount: clip.filter((t) => PAID_SET.has(t.payment_status ?? "")).length,
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
