/**
 * Small text helpers. A `Rich` text is an array of parts; parts flagged `s`
 * (sensitive) are amounts, which the UI masks when Privacy Mode is on.
 */
import type { Part, Rich } from "./types";
import { formatOtherAmount } from "../finance";

export const T = (t: string): Part => ({ t });
export const S = (t: string): Part => ({ t, s: true });
export const rich = (...p: (string | Part)[]): Rich => p.map((x) => (typeof x === "string" ? { t: x } : x));
export const richText = (x: Rich): string => x.map((p) => p.t).join("");

/** "₪3,000" / "$900" / "−₪120". The currency is ALWAYS printed with the amount. */
export function money(amount: number, currency: string): string {
  const abs = Math.abs(amount).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${amount < 0 ? "−" : ""}${currency}${abs}`;
}
export { formatOtherAmount };

/**
 * A per-currency totals map as Rich text: "₪3,000 · $900". Currencies are listed
 * side by side and are NEVER added together. Empty map → "אין".
 */
export function totalsRich(totals: Record<string, number>, order: string[] = ["₪", "$", "€"]): Rich {
  const codes = Object.keys(totals).filter((c) => Math.round((totals[c] ?? 0) * 100) !== 0)
    .sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || (a < b ? -1 : 1));
  if (codes.length === 0) return [T("אין")];
  const out: Rich = [];
  codes.forEach((c, i) => { if (i > 0) out.push(T(" · ")); out.push(S(money(totals[c], c))); });
  return out;
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
