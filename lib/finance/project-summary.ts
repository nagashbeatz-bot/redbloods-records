/**
 * Project payment summary — the pure, testable core of the Projects table money column, the
 * collection card / modal and any other "per project: agreed vs received" surface.
 *
 * Finance single truth (Owner-approved integrity fix, 2026-09-27; one clip model 2026-10-01):
 *   - received = the project's INCOME with a received status (lib/finance/classify.ts), in the
 *     project's OWN finance currency only (R5 — other currencies are never compared, no FX). Every
 *     income row counts, whatever its expense_scope ("קליפ" is a reporting tag, never a second deal —
 *     lib/clip-finance.ts). `projectIncomeTotals` is the ONE per-project aggregation every surface uses;
 *   - agreed price missing / 0 → PRICE_UNKNOWN (never "שולם ✓");
 *   - financeException → no debt, excluded from every collection total;
 *   - every aggregation returns per-currency buckets, never one mixed number.
 *
 * Deliberately a plain module (no "server-only") — the Projects table is a client component.
 */
import { isProjectIncome } from "../clip-finance";
import { collectibleAmount, isCancelledPayment, paymentPosition, actualOutstandingAgainstAgreedPrice, overpaymentAmount } from "../payment-status";
import { isReceivedStatus, isExpectedStatus } from "./classify";
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

/** A transaction as any surface holds it — DB rows and UI rows alike. */
export interface ProjectIncomeTxLike { type?: string | null; payment_status?: string | null; amount?: number | null; currency?: string | null }

/** The project's income against its agreed price, in ONE currency (R5: other currencies are never summed). */
export interface ProjectIncomeTotals { received: number; expected: number; cancelled: number }

/**
 * THE one per-project income aggregation: every income row of the project (any expense_scope), in `currency` only.
 * received = שולם / התקבל, expected = צפוי / לא שולם / חלקי, cancelled = בוטל. Callers pass the project's own rows.
 */
export function projectIncomeTotals(txs: readonly ProjectIncomeTxLike[], currency: string | null | undefined): ProjectIncomeTotals {
  const out: ProjectIncomeTotals = { received: 0, expected: 0, cancelled: 0 };
  for (const t of txs) {
    if (!isProjectIncome(t) || !sameCurrency(t.currency, currency)) continue;
    const a = Number(t.amount) || 0;
    if (isReceivedStatus(t.payment_status)) out.received += a;
    else if (isExpectedStatus(t.payment_status)) out.expected += a;
    else if (isCancelledPayment(t.payment_status)) out.cancelled += a;
  }
  return out;
}

/** `projectIncomeTotals` for every project at once — rows grouped by project_id, each in its project's own currency. */
export function projectIncomeTotalsByProject<T extends ProjectIncomeTxLike & { project_id?: string | null }>(txs: readonly T[], currencyOf: (projectId: string) => string | null | undefined): Map<string, ProjectIncomeTotals> {
  const byProject = new Map<string, T[]>();
  for (const t of txs) {
    if (!t.project_id) continue;
    const list = byProject.get(t.project_id);
    if (list) list.push(t); else byProject.set(t.project_id, [t]);
  }
  const out = new Map<string, ProjectIncomeTotals>();
  for (const [id, rows] of byProject) out.set(id, projectIncomeTotals(rows, currencyOf(id)));
  return out;
}

/** Settings first (the project's currency must be known), then the project's income in that currency only. */
export function buildProjectFinanceSummary(settings: readonly FinanceSettingLike[], transactions: readonly FinanceTxLike[]): Record<string, ProjectFinSummary> {
  const map: Record<string, ProjectFinSummary> = {};
  for (const s of settings) {
    const f = (map[s.project_id] ??= blank());
    f.agreed = Number(s.agreedPrice ?? 0) || 0;
    f.currency = normalizeCurrency(s.currency);
    f.financeException = s.financeException === true;
  }
  const byProject = new Map<string, FinanceTxLike[]>();
  for (const t of transactions) {
    if (!t.project_id) continue;
    map[t.project_id] ??= blank();
    const list = byProject.get(t.project_id);
    if (list) list.push(t); else byProject.set(t.project_id, [t]);
  }
  for (const [id, rows] of byProject) {
    const f = map[id];
    const tot = projectIncomeTotals(rows, f.currency);
    f.paid = tot.received;
    f.cancelled = tot.cancelled;
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
