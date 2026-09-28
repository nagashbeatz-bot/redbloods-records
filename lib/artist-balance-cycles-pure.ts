/**
 * Artist balance cycles — the ONE pure computation (no DB), shared by the cycle store (app routes / portal) and
 * Sunny's label view, so the two can never disagree.
 *
 * Owner decision 2026-09-28 (question 8): closing a cycle is a periodic SETTLEMENT PICTURE between the Owner and the
 * artist, never an automatic reset. The settlement itself happens outside the system; a real payment is recorded the
 * normal way; an unpaid balance stays open and carries into the next cycle. There is NO offset mechanism.
 *
 *   closing balance = opening balance + artist income − artist expenses − payments to the artist
 *   opening balance = the previous closed cycle's closing balance
 *                     (first cycle: the net of any realized history dated before it — 0 when there is none)
 *
 * A closed cycle is an immutable snapshot. An entry that arrives later but is dated inside an already-closed period
 * is counted in the OPEN cycle ("belongs to an earlier period") — the snapshot never changes. Check: the open cycle's
 * closing balance always equals the ledger's realized balance up to the cycle end; a non-zero `reconciliationDifference`
 * means a closed-period entry was edited or deleted after its cycle closed (shown, never hidden).
 */

export type SettlementResult = "RECORDS_OWES_ARTIST" | "ARTIST_OWES_RECORDS" | "BALANCED";

export interface CycleLedgerEntry { id: string; entryType: string | null; amount: number | null; entryDate: string | null; createdAt: string | null }
export interface CycleSnapshotRow { cycleIndex: number; startDate: string; endDate: string; income: number; payments: number; expenses: number; endingBalance: number; closedAt: string }
export interface CycleTotals { income: number; expectedIncome: number; payments: number; expenses: number; expectedExpenses: number; currentBalance: number }

export interface ComputedCycle {
  index: number;
  startDate: string;
  endDate: string;          // exclusive
  calcStartDate: string;    // cycle 0 with a first-cycle bootstrap: the earlier bootstrap date
  daysUntilClose: number;
  openingBalance: number;
  /** this cycle's activity: entries dated in the window + late entries dated in an earlier, already-closed period */
  totals: CycleTotals;
  closingBalance: number;
  result: SettlementResult;
  lateEntryIds: string[];
  /** realized ledger balance of every entry dated before the cycle end */
  ledgerBalanceToEnd: number;
  /** ledgerBalanceToEnd − closingBalance; 0 unless a closed-period entry changed after its cycle closed */
  reconciliationDifference: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── date math (plain YYYY-MM-DD strings, UTC-based — no local-timezone drift) ────
function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function toYmd(y: number, m0: number, d: number): string {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}
export function addMonthsYmd(s: string, months: number): string {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  return toYmd(ny, total - ny * 12, d);
}
export function daysBetweenYmd(from: string, to: string): number {
  const a = parseYmd(from), b = parseYmd(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
/** Which 2-month window (by pure calendar math) `today` falls into, relative to the anchor. */
export function cycleIndexForDate(anchor: string, today: string): number {
  const a = parseYmd(anchor), t = parseYmd(today);
  let monthsSince = (t.y * 12 + (t.m - 1)) - (a.y * 12 + (a.m - 1));
  if (t.d < a.d) monthsSince -= 1;
  return Math.max(Math.floor(monthsSince / 2), 0);
}
export function cycleBounds(anchor: string, index: number): { start: string; end: string } {
  return { start: addMonthsYmd(anchor, index * 2), end: addMonthsYmd(anchor, (index + 1) * 2) };
}
/** The current cycle index: the calendar window, but never behind the number of closed cycles (an early close advances it). */
export function currentCycleIndex(anchor: string, today: string, closedCount: number): number {
  return Math.max(cycleIndexForDate(anchor, today), closedCount);
}

// ── money ─────────────────────────────────────────────────────────────────────────
export function cycleTotalsOf(entries: readonly CycleLedgerEntry[]): CycleTotals {
  const sum = (t: string) => r2(entries.filter((e) => e.entryType === t).reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const income = sum("הכנסות"), payments = sum("תשלומים"), expenses = sum("הוצאות");
  return { income, expectedIncome: sum("הכנסות צפויות"), payments, expenses, expectedExpenses: sum("הוצאות צפויות"), currentBalance: r2(income - payments - expenses) };
}
const realizedNet = (entries: readonly CycleLedgerEntry[]) => cycleTotalsOf(entries).currentBalance;

export function settlementResultOf(balance: number): SettlementResult {
  const b = r2(balance);
  return b > 0 ? "RECORDS_OWES_ARTIST" : b < 0 ? "ARTIST_OWES_RECORDS" : "BALANCED";
}
export const SETTLEMENT_RESULT_HE: Readonly<Record<SettlementResult, string>> = {
  RECORDS_OWES_ARTIST: "Records חייבת לאמן",
  ARTIST_OWES_RECORDS: "האמן בחובה ל-Records",
  BALANCED: "החשבון מאוזן",
};

/** A closed snapshot's opening balance, derived from what it stored: closing − (income − payments − expenses). */
export function openingOfSnapshot(s: Pick<CycleSnapshotRow, "endingBalance" | "income" | "payments" | "expenses">): number {
  return r2(s.endingBalance - (s.income - s.payments - s.expenses));
}

const ts = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** The open cycle, computed from the anchor, the optional first-cycle bootstrap, the closed snapshots and the ledger. */
export function computeOpenCycle(input: {
  anchor: string;
  bootstrap: string | null;
  closed: readonly CycleSnapshotRow[];
  entries: readonly CycleLedgerEntry[];
  today: string;
}): ComputedCycle {
  const { anchor, bootstrap, entries, today } = input;
  const closed = [...input.closed].sort((a, b) => a.cycleIndex - b.cycleIndex);
  const index = currentCycleIndex(anchor, today, closed.length);
  const { start, end } = cycleBounds(anchor, index);
  const calcStart = index === 0 && bootstrap && bootstrap < start ? bootstrap : start;
  const dated = entries.filter((e) => !!e.entryDate);
  const last = closed.length ? closed[closed.length - 1] : null;

  let openingBalance: number;
  let late: CycleLedgerEntry[] = [];
  if (!last) {
    // No closed snapshot yet: everything realized before this cycle is carried in as its opening balance
    // (e.g. history recorded before the artist's first cycle, or a whole earlier cycle that was never closed).
    openingBalance = realizedNet(dated.filter((e) => e.entryDate! < calcStart));
  } else {
    openingBalance = r2(last.endingBalance);
    // Dated in an already-closed period but recorded after the last close → not in any snapshot → counted here.
    const lastClosedAt = ts(last.closedAt);
    late = dated.filter((e) => e.entryDate! < calcStart && ts(e.createdAt) > lastClosedAt);
  }

  const inWindow = dated.filter((e) => e.entryDate! >= calcStart && e.entryDate! < end);
  const totals = cycleTotalsOf([...inWindow, ...late]);
  const closingBalance = r2(openingBalance + totals.currentBalance);
  const ledgerBalanceToEnd = realizedNet(dated.filter((e) => e.entryDate! < end));
  return {
    index, startDate: start, endDate: end, calcStartDate: calcStart,
    daysUntilClose: daysBetweenYmd(today, end),
    openingBalance, totals, closingBalance,
    result: settlementResultOf(closingBalance),
    lateEntryIds: late.map((e) => e.id),
    ledgerBalanceToEnd,
    reconciliationDifference: r2(ledgerBalanceToEnd - closingBalance),
  };
}
