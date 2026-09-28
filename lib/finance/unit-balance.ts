/**
 * Unit balance — the ONE money position per Redbloods business unit (task 5, Owner decisions 2026-09-28). Pure, no I/O.
 * Finance screen and Sunny read it; nothing else computes a second version of these numbers.
 *
 *   Finance = real money in / out. Realized: income received (שולם / התקבל), expense paid (שולם) — lib/finance/classify.
 *   Expected (isExpectedStatus: צפוי / לא שולם / חלקי) is a forecast, never cash. בוטל is never money.
 *   Every total is per currency — ₪ and $ are never added.
 *
 *   Records adds the artist settlement (the artist ledger — net model, 2026-09-28):
 *     cash                 = realized Records income − realized Records expenses (real payments to artists included)
 *     artist liabilities   = Σ positive realized ledger balances of Records roster artists (what Records still owes)
 *     artist receivables   = Σ negative balances (an artist owes Records) — shown apart, never money
 *     available to invest  = cash − artist liabilities − reserve (reserve 0)
 *     future entitlements  = ledger "הכנסות צפויות" that are active (not marked inactive, their show not cancelled) —
 *                            NOT cash and NOT a liability yet
 *     future cash expense  = Records Finance expenses still expected
 *   No double count: a real payment to an artist is a Finance expense AND a ledger payment — the ledger balance is what
 *   remains owed, so it is subtracted once. Entitlements live only in the ledger, never as a Finance expense.
 *
 *   "כל Redbloods" = the sum of the units' real money per currency (no internal transfers / revenue / pricing), plus the
 *   Records artist liabilities as a separate line ("available after liabilities"), never renamed "cash".
 */
import { isCancelledStatus, isExpectedStatus, isExpenseFullyPaidStatus, isReceivedStatus } from "./classify";
import { normalizeCurrency, type CurrencyTotals } from "./currency";

export const UNIT_KEYS = ["STUDIO", "RECORDS", "FILMS", "CORPORATE"] as const;
export type UnitKey = (typeof UNIT_KEYS)[number];
export const RECORDS_RESERVE_ILS = 0;

export interface UnitTx { id: string; type: string | null; amount: unknown; currency: string | null; paymentStatus: string | null; businessUnit: string | null; category?: string | null; linkedSessionId?: string | null; showId?: string | null; showMoneyRole?: string | null; artist?: string | null; date?: string | null }
export interface UnitLedgerRow { id: string; artistId: string; entryType: string | null; amount: unknown; sourceTxId: string | null; sourceShowId?: string | null; note?: string | null }
export interface UnitShow { id: string; status: string | null }
export interface UnitArtist { id: string; name: string }

export interface MoneyPosition {
  realizedIncome: CurrencyTotals; realizedExpense: CurrencyTotals; cash: CurrencyTotals;
  expectedIncome: CurrencyTotals; expectedExpense: CurrencyTotals;
  cancelled: { income: CurrencyTotals; expense: CurrencyTotals };
  rows: number;
}
export interface ArtistBalanceLine { artistId: string; name: string; balance: number }
export interface RecordsSettlement {
  artistLiabilities: number;            // ₪ (the ledger has no currency — screens show ₪)
  artistReceivables: number;            // ₪, an artist owes Records (never money)
  byArtist: ArtistBalanceLine[];
  reserve: number;
  availableToInvest: CurrencyTotals;    // cash − liabilities (₪); other currencies = their cash
  futureArtistEntitlements: { total: number; rows: Array<{ id: string; artistId: string; amount: number; showId: string | null }> };
  futureCashExpenses: CurrencyTotals;
}
export interface UnitBalance {
  units: Record<UnitKey, MoneyPosition>;
  unclassified: MoneyPosition;
  all: MoneyPosition & { artistLiabilities: number; availableAfterLiabilities: CurrencyTotals };
  records: RecordsSettlement;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const add = (m: CurrencyTotals, c: string | null | undefined, v: number) => { const k = normalizeCurrency(c); m[k] = r2((m[k] ?? 0) + v); return m; };
const minus = (a: CurrencyTotals, b: CurrencyTotals): CurrencyTotals => { const out: CurrencyTotals = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = r2((a[k] ?? 0) - (b[k] ?? 0)); return out; };
const empty = (): MoneyPosition => ({ realizedIncome: {}, realizedExpense: {}, cash: {}, expectedIncome: {}, expectedExpense: {}, cancelled: { income: {}, expense: {} }, rows: 0 });

/** One transaction into a position (the canonical status rules). */
function accumulate(p: MoneyPosition, t: UnitTx): void {
  p.rows++;
  const a = num(t.amount), c = t.currency;
  if (isCancelledStatus(t.paymentStatus)) { add(t.type === "income" ? p.cancelled.income : p.cancelled.expense, c, a); return; }
  if (t.type === "income") {
    if (isReceivedStatus(t.paymentStatus)) add(p.realizedIncome, c, a);
    else if (isExpectedStatus(t.paymentStatus)) add(p.expectedIncome, c, a);
  } else if (t.type === "expense") {
    if (isExpenseFullyPaidStatus(t.paymentStatus)) add(p.realizedExpense, c, a);
    else if (isExpectedStatus(t.paymentStatus)) add(p.expectedExpense, c, a);
  }
}
const finish = (p: MoneyPosition): MoneyPosition => ({ ...p, cash: minus(p.realizedIncome, p.realizedExpense) });

/** Is an expected entitlement active? (not marked inactive by the show sync; its show not cancelled) */
export const INACTIVE_ENTITLEMENT_PREFIX = "[זכאות לא פעילה]";
export function isActiveEntitlement(row: UnitLedgerRow, shows: readonly UnitShow[]): boolean {
  if (row.entryType !== "הכנסות צפויות") return false;
  if ((row.note ?? "").startsWith(INACTIVE_ENTITLEMENT_PREFIX)) return false;
  const show = row.sourceShowId ? shows.find((s) => s.id === row.sourceShowId) : null;
  return !(show && show.status === "בוטל");
}

/** The realized ledger balance of one artist: income − payments − expenses (expected rows not counted). */
export function ledgerBalanceOf(rows: readonly UnitLedgerRow[]): number {
  let b = 0;
  for (const e of rows) { const a = num(e.amount); if (e.entryType === "הכנסות") b += a; else if (e.entryType === "תשלומים" || e.entryType === "הוצאות") b -= a; }
  return r2(b);
}

export function computeUnitBalance(input: { transactions: readonly UnitTx[]; ledger: readonly UnitLedgerRow[]; roster: readonly UnitArtist[]; shows: readonly UnitShow[] }): UnitBalance {
  const units = Object.fromEntries(UNIT_KEYS.map((u) => [u, empty()])) as Record<UnitKey, MoneyPosition>;
  const unclassified = empty(), all = empty();
  for (const t of input.transactions) {
    const u = (UNIT_KEYS as readonly string[]).includes(String(t.businessUnit)) ? (t.businessUnit as UnitKey) : null;
    accumulate(u ? units[u] : unclassified, t);
    accumulate(all, t);
  }
  for (const u of UNIT_KEYS) units[u] = finish(units[u]);
  const allF = finish(all);

  // Records settlement — every Records roster artist, by id (the ledger is per artist)
  const byArtist: ArtistBalanceLine[] = input.roster.map((a) => ({ artistId: a.id, name: a.name, balance: ledgerBalanceOf(input.ledger.filter((e) => e.artistId === a.id)) }));
  const artistLiabilities = r2(byArtist.reduce((s, x) => s + Math.max(x.balance, 0), 0));
  const artistReceivables = r2(byArtist.reduce((s, x) => s + Math.max(-x.balance, 0), 0));
  const rosterIds = new Set(input.roster.map((a) => a.id));
  const futureRows = input.ledger.filter((e) => rosterIds.has(e.artistId) && isActiveEntitlement(e, input.shows)).map((e) => ({ id: e.id, artistId: e.artistId, amount: num(e.amount), showId: e.sourceShowId ?? null }));
  const rec = units.RECORDS;
  const ils = normalizeCurrency("₪");
  const availableToInvest = { ...rec.cash, [ils]: r2((rec.cash[ils] ?? 0) - artistLiabilities - RECORDS_RESERVE_ILS) };
  return {
    units, unclassified: finish(unclassified),
    all: { ...allF, artistLiabilities, availableAfterLiabilities: { ...allF.cash, [ils]: r2((allF.cash[ils] ?? 0) - artistLiabilities) } },
    records: {
      artistLiabilities, artistReceivables, byArtist, reserve: RECORDS_RESERVE_ILS, availableToInvest,
      futureArtistEntitlements: { total: r2(futureRows.reduce((s, r) => s + r.amount, 0)), rows: futureRows },
      futureCashExpenses: { ...rec.expectedExpense },
    },
  };
}

// ── Artist payment reconciliation (Finance ↔ ledger) — the net model's integrity check ──

/** Historical exceptions the Owner approved (2026-09-28): real cash out, deliberately NOT in the ledger. Never a finding. */
export const EXPLAINED_ARTIST_PAYMENTS: Readonly<Record<string, string>> = {
  "e012d6d4-8dcf-42c7-925d-364964af18c2": "פאצ'ה 1,000 — חריג היסטורי מאושר (כסף שיצא, מחוץ ליומן)",
  "937031f5-9e22-4fce-91f7-77a2596f3503": "סאמר טיים 810 — חריג היסטורי מאושר (כסף שיצא, מחוץ ליומן)",
};
export interface ArtistPaymentReconciliation {
  ledgerPaymentsWithoutFinance: Array<{ ledgerEntryId: string; artistId: string; amount: number }>;
  financePaymentsWithoutLedger: Array<{ transactionId: string; amount: number; artist: string | null }>;
  explained: Array<{ transactionId: string; reasonHe: string }>;
}
const isArtistPaymentTx = (t: UnitTx) => t.type === "expense" && isExpenseFullyPaidStatus(t.paymentStatus) && (t.category === "שכר אמן" || t.showMoneyRole === "ARTIST_FEE");

/**
 * Every ledger payment must stand for a paid Finance row (linked by source_tx_id, or — for a show payment — a paid
 * artist row of the same show), and every paid Finance artist payment must appear in the ledger the same way.
 */
export function reconcileArtistPayments(input: { transactions: readonly UnitTx[]; ledger: readonly UnitLedgerRow[] }): ArtistPaymentReconciliation {
  const txById = new Map(input.transactions.map((t) => [t.id, t]));
  const payments = input.ledger.filter((e) => e.entryType === "תשלומים");
  const paidArtistTx = input.transactions.filter(isArtistPaymentTx);
  const ledgerPaymentsWithoutFinance = payments.filter((e) => {
    const t = e.sourceTxId ? txById.get(e.sourceTxId) : undefined;
    if (t && t.type === "expense" && isExpenseFullyPaidStatus(t.paymentStatus)) return false;
    if (e.sourceShowId && paidArtistTx.some((x) => x.showId === e.sourceShowId)) return false;
    return true;
  }).map((e) => ({ ledgerEntryId: e.id, artistId: e.artistId, amount: num(e.amount) }));
  const explained: ArtistPaymentReconciliation["explained"] = [];
  const financePaymentsWithoutLedger = paidArtistTx.filter((t) => {
    if (EXPLAINED_ARTIST_PAYMENTS[t.id]) { explained.push({ transactionId: t.id, reasonHe: EXPLAINED_ARTIST_PAYMENTS[t.id] }); return false; }
    if (payments.some((e) => e.sourceTxId === t.id)) return false;
    if (t.showId && payments.some((e) => e.sourceShowId === t.showId)) return false;
    return true;
  }).map((t) => ({ transactionId: t.id, amount: num(t.amount), artist: t.artist ?? null }));
  return { ledgerPaymentsWithoutFinance, financePaymentsWithoutLedger, explained };
}
