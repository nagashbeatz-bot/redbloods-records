/**
 * Project payment summary — the pure, testable core of the Projects table money column, the
 * collection card / modal and any other "per project: agreed vs received" surface.
 *
 * Finance single truth (Owner-approved integrity fix, 2026-09-27):
 *   - received = song-deal INCOME with a received status (lib/finance/classify.ts), in the
 *     project's OWN finance currency only (R5 — other currencies are never compared, no FX);
 *   - agreed price missing / 0 → PRICE_UNKNOWN (never "שולם ✓");
 *   - financeException → no debt, excluded from every collection total;
 *   - every aggregation returns per-currency buckets, never one mixed number.
 *
 * Deliberately a plain module (no "server-only") — the Projects table is a client component.
 */
import { isSongIncome } from "../clip-finance";
import { collectibleAmount, isCancelledPayment, paymentPosition, actualOutstandingAgainstAgreedPrice, overpaymentAmount } from "../payment-status";
import { isReceivedStatus } from "./classify";
import { normalizeCurrency, sameCurrency, type CurrencyTotals } from "./currency";

export interface ProjectFinSummary {
  paid: number;
  agreed: number;
  cancelled: number;
  /** The project's finance currency (the agreed price's currency). */
  currency: string;
  /** No-charge / favor project: never owes, never in a collection total. */
  financeException: boolean;
}

export interface FinanceSettingLike { project_id: string; agreedPrice?: number | null; currency?: string | null; financeException?: boolean | null }
export interface FinanceTxLike { project_id: string | null; type?: string | null; payment_status?: string | null; amount: number; expense_scope?: string | null; currency?: string | null }

const blank = (): ProjectFinSummary => ({ paid: 0, agreed: 0, cancelled: 0, currency: normalizeCurrency(null), financeException: false });

/** Settings first (the project's currency must be known), then song income in that currency only. */
export function buildProjectFinanceSummary(settings: readonly FinanceSettingLike[], transactions: readonly FinanceTxLike[]): Record<string, ProjectFinSummary> {
  const map: Record<string, ProjectFinSummary> = {};
  for (const s of settings) {
    const f = (map[s.project_id] ??= blank());
    f.agreed = Number(s.agreedPrice ?? 0) || 0;
    f.currency = normalizeCurrency(s.currency);
    f.financeException = s.financeException === true;
  }
  for (const t of transactions) {
    if (!t.project_id) continue;
    const f = (map[t.project_id] ??= blank());
    if (!isSongIncome(t)) continue;
    if (!sameCurrency(t.currency, f.currency)) continue;
    if (isReceivedStatus(t.payment_status)) f.paid += t.amount;
    if (isCancelledPayment(t.payment_status)) f.cancelled += t.amount;
  }
  return map;
}

export type ProjectMoneyBadge =
  | { kind: "EXCEPTION" }
  | { kind: "PRICE_UNKNOWN"; received: number; currency: string }
  | { kind: "PAID"; currency: string }
  | { kind: "OVERPAID"; credit: number; currency: string }
  | { kind: "BALANCE"; balance: number; currency: string };

/** The one per-project money verdict for a badge: exception → price unknown → paid / overpaid / balance. */
export function projectMoneyBadge(fin: ProjectFinSummary): ProjectMoneyBadge {
  if (fin.financeException) return { kind: "EXCEPTION" };
  const pos = paymentPosition(fin.agreed, fin.paid);
  if (pos === "PRICE_UNKNOWN") return { kind: "PRICE_UNKNOWN", received: fin.paid, currency: fin.currency };
  if (pos === "OVERPAID") return { kind: "OVERPAID", credit: overpaymentAmount(fin.agreed, fin.paid), currency: fin.currency };
  if (pos === "PAID") return { kind: "PAID", currency: fin.currency };
  return { kind: "BALANCE", balance: actualOutstandingAgainstAgreedPrice(fin.agreed, fin.paid), currency: fin.currency };
}

/** Collection intent for ONE project (0 for a finance exception or an unknown price). */
export function projectCollectible(fin: ProjectFinSummary, projectStatus: string | null | undefined): number {
  if (fin.financeException || !(fin.agreed > 0)) return 0;
  return collectibleAmount(fin.agreed, fin.paid, fin.cancelled, projectStatus);
}

/**
 * "לגבייה" total PER CURRENCY over projects that exist (`statusById`), excluding finance-exception
 * projects. Never one mixed number.
 */
export function collectionTotalsByCurrency(summary: Record<string, ProjectFinSummary>, statusById: ReadonlyMap<string, string | null | undefined>): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const [id, f] of Object.entries(summary)) {
    if (!statusById.has(id)) continue;
    const r = projectCollectible(f, statusById.get(id));
    if (r > 0) totals[f.currency] = (totals[f.currency] ?? 0) + r;
  }
  return totals;
}
