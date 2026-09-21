/**
 * Currency-safe aggregation. There is NO FX conversion anywhere in here and no
 * global exchange rate: amounts in different currencies are never added together.
 * A "total" is a map keyed by currency; the Owner UI keeps ₪ as the headline and
 * shows any other currency on its own line.
 *
 * Deliberately a plain module (no "server-only") — it is used by client components.
 */

/** The headline currency, and what an empty/missing currency means everywhere in the app. */
export const DEFAULT_CURRENCY = "₪";

/** amounts keyed by currency symbol, e.g. { "₪": 13180, "$": 2200 } */
export type CurrencyTotals = Record<string, number>;

/** Missing/blank currency is ₪ — the assumption every existing surface already made. */
export function normalizeCurrency(currency: string | null | undefined): string {
  const c = (currency ?? "").trim();
  return c === "" ? DEFAULT_CURRENCY : c;
}

export function sameCurrency(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeCurrency(a) === normalizeCurrency(b);
}

type WithCurrency = { currency?: string | null };

/**
 * R5 helper: split rows into those in `currency` and everything else. Money that
 * is compared against a project's agreedPrice must come only from `same`.
 */
export function partitionByCurrency<T extends WithCurrency>(rows: readonly T[], currency: string | null | undefined): { same: T[]; other: T[] } {
  const target = normalizeCurrency(currency);
  const same: T[] = [];
  const other: T[] = [];
  for (const r of rows) (normalizeCurrency(r.currency) === target ? same : other).push(r);
  return { same, other };
}

/** Group rows by normalized currency, preserving row order inside each group. */
export function groupByCurrency<T extends WithCurrency>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const c = normalizeCurrency(r.currency);
    const list = m.get(c);
    if (list) list.push(r); else m.set(c, [r]);
  }
  return m;
}

/**
 * Sum `amountOf(row)` per currency. Rows of one currency are summed in their
 * original order, so a ₪-only input yields exactly the same float as a plain
 * `reduce((s, t) => s + t.amount, 0)`.
 */
export function sumByCurrency<T extends WithCurrency>(rows: readonly T[], amountOf: (row: T) => number): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const r of rows) {
    const c = normalizeCurrency(r.currency);
    totals[c] = (totals[c] ?? 0) + amountOf(r);
  }
  return totals;
}

/** Add `amount` to `totals[currency]` (mutates and returns `totals`). */
export function addToTotals(totals: CurrencyTotals, currency: string | null | undefined, amount: number): CurrencyTotals {
  const c = normalizeCurrency(currency);
  totals[c] = (totals[c] ?? 0) + amount;
  return totals;
}

/** Amount for one currency, 0 when absent. */
export function totalOf(totals: CurrencyTotals | undefined, currency: string = DEFAULT_CURRENCY): number {
  return totals?.[currency] ?? 0;
}

/** ₪ first, then $, €, then anything else alphabetically — stable display order. */
export function orderCurrencies(codes: readonly string[]): string[] {
  const rank = (c: string) => (c === DEFAULT_CURRENCY ? 0 : c === "$" ? 1 : c === "€" ? 2 : 3);
  // Plain code-unit comparison (not localeCompare) so the order never depends on the runtime's ICU data.
  return [...codes].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

const isZero = (n: number) => Math.round(n * 100) === 0;

export interface CurrencyAmount { currency: string; amount: number }

/**
 * Non-headline currencies with a non-zero amount, in display order. This is what
 * the second line under a headline number is built from.
 */
export function otherCurrencyAmounts(totals: CurrencyTotals | undefined, headline: string = DEFAULT_CURRENCY): CurrencyAmount[] {
  if (!totals) return [];
  return orderCurrencies(Object.keys(totals))
    .filter((c) => c !== headline && !isZero(totals[c]))
    .map((currency) => ({ currency, amount: totals[currency] }));
}

/**
 * Same, but for a map of per-currency stat objects (e.g. PeriodStats.other):
 * pick one figure out of each currency's stats.
 */
export function otherAmountsFrom<T>(byCurrency: Record<string, T> | undefined, pick: (s: T) => number): CurrencyAmount[] {
  if (!byCurrency) return [];
  return orderCurrencies(Object.keys(byCurrency))
    .map((currency) => ({ currency, amount: pick(byCurrency[currency]) }))
    .filter((x) => !isZero(x.amount));
}

/**
 * Display text for a non-headline currency amount: symbol first ("$2,200"),
 * negatives as "−$2,200". Callers render it inside a `direction: ltr` +
 * `unicode-bidi: isolate` span so it reads correctly inside RTL pages.
 * (₪ amounts keep each surface's own existing formatter — this is only for the
 * additional currencies.)
 */
export function formatOtherAmount(amount: number, currency: string): string {
  const abs = Math.abs(amount).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${amount < 0 ? "−" : ""}${currency}${abs}`;
}

/** Ready-to-render lines for the additional currencies of a totals map. */
export function otherCurrencyLines(totals: CurrencyTotals | undefined, headline: string = DEFAULT_CURRENCY): string[] {
  return otherCurrencyAmounts(totals, headline).map((x) => formatOtherAmount(x.amount, x.currency));
}

/** Same for a list already built with otherAmountsFrom / otherCurrencyAmounts. */
export function formatCurrencyAmounts(items: readonly CurrencyAmount[]): string[] {
  return items.map((x) => formatOtherAmount(x.amount, x.currency));
}
