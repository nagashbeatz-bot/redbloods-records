/**
 * Expected-income aggregation for the dashboard (pure, testable). Finance single truth, 2026-09-27:
 * every total is PER CURRENCY (no FX, never one mixed number); a show's expected income is the
 * Finance income row of that show (show_id, D5) or a legacy category "הופעה" income row, in its
 * own currency, while it is still expected (lib/finance/classify.ts isExpectedStatus).
 *
 * Deliberately a plain module (no "server-only").
 */
import { isExpectedStatus } from "./classify";
import { normalizeCurrency, type CurrencyTotals } from "./currency";

export interface ShowIncomeTxLike {
  id: string;
  type?: string | null;
  payment_status?: string | null;
  category?: string | null;
  show_id?: string | null;
  description?: string | null;
  artist?: string | null;
  amount?: number | null;
  date?: string | null;
  currency?: string | null;
}

export interface ShowExpectedItem { id: string; description: string; artist: string; amount: number; date: string | null; currency: string }

/** Still-expected show income rows (Finance), each in its own currency, plus per-currency totals. */
export function showExpectedIncome(txs: readonly ShowIncomeTxLike[]): { items: ShowExpectedItem[]; totals: CurrencyTotals } {
  const items = txs
    .filter((t) => t.type === "income" && isExpectedStatus(t.payment_status) && (!!t.show_id || t.category === "הופעה"))
    .map((t) => ({ id: t.id, description: t.description ?? "הופעה", artist: t.artist ?? "", amount: Number(t.amount) || 0, date: t.date ?? null, currency: normalizeCurrency(t.currency) }));
  return { items, totals: mergeCurrencyTotals(...items.map((i) => ({ [i.currency]: i.amount }))) };
}

/** Add several per-currency maps bucket by bucket (never across currencies). */
export function mergeCurrencyTotals(...maps: ReadonlyArray<CurrencyTotals | null | undefined>): CurrencyTotals {
  const out: CurrencyTotals = {};
  for (const m of maps) for (const [c, v] of Object.entries(m ?? {})) out[c] = (out[c] ?? 0) + (Number(v) || 0);
  return out;
}
