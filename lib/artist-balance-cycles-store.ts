import "server-only";
import { supabase } from "./supabase";
import {
  type ArtistBalanceEntry,
  type ArtistBalanceTotals,
  computeArtistBalanceTotals,
  isValidYmd,
} from "./artist-balance-store";

/**
 * Financial-cycle layer on top of the artist balance ledger (public.artist_balance_cycles
 * + a settings row per artist for the anchor date). Additive only — never touches
 * artist_balance_entries. An artist with no anchor configured behaves exactly as
 * before (the caller gets `anchorDate: null` and ignores the rest).
 *
 * Cycles are fixed, non-overlapping 2-month windows starting at the artist's anchor
 * date: [anchor, anchor+2mo), [anchor+2mo, anchor+4mo), … "cycle_index" is 0-based.
 * Only CLOSED cycles are persisted (a frozen snapshot); the current (open) cycle's
 * totals are always computed live from the ledger so they stay accurate until closed.
 */

// ── date math (plain YYYY-MM-DD strings, UTC-based — no local-timezone drift) ────

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function toYmd(y: number, m0: number, d: number): string {
  // m0 is 0-based; Date.UTC normalizes month/day overflow for us.
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

function addMonthsYmd(s: string, months: number): string {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm0 = total - ny * 12;
  return toYmd(ny, nm0, d);
}

function addDaysYmd(s: string, days: number): string {
  const { y, m, d } = parseYmd(s);
  return toYmd(y, m - 1, d + days);
}

function daysBetweenYmd(from: string, to: string): number {
  const a = parseYmd(from), b = parseYmd(to);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

/** Which 2-month window (by pure calendar math) `today` falls into, relative to anchor. */
function cycleIndexForDate(anchor: string, today: string): number {
  const a = parseYmd(anchor), t = parseYmd(today);
  let monthsSince = (t.y * 12 + (t.m - 1)) - (a.y * 12 + (a.m - 1));
  if (t.d < a.d) monthsSince -= 1;
  return Math.max(Math.floor(monthsSince / 2), 0);
}

function cycleBounds(anchor: string, index: number): { start: string; end: string } {
  return { start: addMonthsYmd(anchor, index * 2), end: addMonthsYmd(anchor, (index + 1) * 2) };
}

// ── anchor date (stored in the generic settings key/value table — one row per artist) ──

const anchorKey = (artistId: string) => `balance_cycle_anchor:${artistId}`;

export async function getBalanceCycleAnchor(artistId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("settings").select("value").eq("key", anchorKey(artistId)).maybeSingle();
  if (error) throw new Error(error.message);
  const v = data?.value as { anchorDate?: string } | null;
  return v?.anchorDate ?? null;
}

/** First-time activation for an artist that has no anchor yet. Throws a Hebrew,
 *  user-facing message when an anchor already exists (use updateBalanceCycleAnchor
 *  to correct it instead — a plain INSERT never overwrites) or the date is
 *  malformed. */
export async function setBalanceCycleAnchor(artistId: string, anchorDate: string): Promise<void> {
  if (!isValidYmd(anchorDate)) throw new Error("תאריך לא תקין (YYYY-MM-DD)");
  const { error } = await supabase.from("settings").insert({ key: anchorKey(artistId), value: { anchorDate } });
  if (error) {
    if (error.code === "23505") throw new Error("תאריך העוגן כבר הוגדר עבור אמן זה");
    throw new Error(error.message);
  }
}

/** Corrects an already-activated anchor (e.g. a typo'd first activation) — ONLY
 *  while the artist has zero closed cycles. Once a cycle has been closed, its
 *  frozen snapshot's start/end dates are permanent history; retroactively moving
 *  the anchor would silently make that snapshot's dates lie, so this refuses
 *  outright rather than leaving a corrupted-looking history. Recomputes nothing
 *  in the DB — the next getBalanceCycleState() call re-derives everything live
 *  from the new anchor; no snapshot is created, no entry is touched. */
export async function updateBalanceCycleAnchor(artistId: string, anchorDate: string): Promise<void> {
  if (!isValidYmd(anchorDate)) throw new Error("תאריך לא תקין (YYYY-MM-DD)");
  const closed = await listClosedBalanceCycles(artistId);
  if (closed.length > 0) {
    throw new Error("לא ניתן לשנות את תאריך העוגן — כבר נסגר מחזור אחד לפחות עבור אמן זה");
  }
  const { data, error } = await supabase
    .from("settings").update({ value: { anchorDate } }).eq("key", anchorKey(artistId)).select("key");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("לא הוגדר עדיין מחזור כספי עבור אמן זה — יש להפעיל תחילה");
}

/** Human-facing "closing" line — never a negative day count. Shared by the
 *  manual reminder push and (if ever needed) any other cycle-status copy. */
export function cycleClosingLine(daysUntilClose: number): string {
  if (daysUntilClose > 0) return `נסגר בעוד ${daysUntilClose} ימים`;
  if (daysUntilClose === 0) return "נסגר היום";
  return "כבר היה אמור להיסגר וממתין לסגירה";
}

// ── closed cycles (public.artist_balance_cycles — frozen snapshots) ─────────────

export interface ClosedBalanceCycle {
  id: string;
  artistId: string;
  cycleIndex: number;
  startDate: string;
  endDate: string;        // exclusive
  income: number;
  expectedIncome: number;
  payments: number;
  expenses: number;
  expectedExpenses: number;
  endingBalance: number;
  closedAt: string;
  createdAt: string;
}

interface DbCycleRow {
  id: string;
  artist_id: string;
  cycle_index: number;
  start_date: string;
  end_date: string;
  income: number | string;
  expected_income: number | string;
  payments: number | string;
  expenses: number | string;
  expected_expenses: number | string;
  ending_balance: number | string;
  closed_at: string;
  created_at: string;
}

function mapCycleRow(db: DbCycleRow): ClosedBalanceCycle {
  return {
    id: db.id,
    artistId: db.artist_id,
    cycleIndex: db.cycle_index,
    startDate: db.start_date,
    endDate: db.end_date,
    income: Number(db.income) || 0,
    expectedIncome: Number(db.expected_income) || 0,
    payments: Number(db.payments) || 0,
    expenses: Number(db.expenses) || 0,
    expectedExpenses: Number(db.expected_expenses) || 0,
    endingBalance: Number(db.ending_balance) || 0,
    closedAt: db.closed_at,
    createdAt: db.created_at,
  };
}

export async function listClosedBalanceCycles(artistId: string): Promise<ClosedBalanceCycle[]> {
  const { data, error } = await supabase
    .from("artist_balance_cycles").select("*").eq("artist_id", artistId).order("cycle_index", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbCycleRow[]).map(mapCycleRow);
}

// ── the ONE shared "current cycle" computation ───────────────────────────────────

export interface CurrentBalanceCycle {
  index: number;
  startDate: string;
  endDate: string;          // exclusive
  displayEndDate: string;   // end_date − 1 day, for a non-overlapping-looking label
  daysUntilClose: number;   // negative when the natural end date has already passed
  totals: ArtistBalanceTotals;
}

export interface BalanceCycleState {
  anchorDate: string | null;   // null = cycles not configured for this artist yet
  current: CurrentBalanceCycle | null;
  closed: ClosedBalanceCycle[];
}

/** entries already loaded by the caller (same ledger the balance page fetches) —
 *  avoids a second round-trip to list them again here. */
export async function getBalanceCycleState(
  artistId: string,
  entries: ArtistBalanceEntry[],
): Promise<BalanceCycleState> {
  const anchorDate = await getBalanceCycleAnchor(artistId);
  if (!anchorDate) return { anchorDate: null, current: null, closed: [] };

  const closed = await listClosedBalanceCycles(artistId);
  const today = new Date().toISOString().slice(0, 10);

  // The grid keeps advancing by calendar date regardless of whether anyone closes a
  // cycle on time — but closing (possibly early) always advances the "current" one
  // immediately, so it never regresses. In the ordinary flow (closing at/after the
  // natural end date) these coincide.
  const index = Math.max(cycleIndexForDate(anchorDate, today), closed.length);
  const { start, end } = cycleBounds(anchorDate, index);
  const cycleEntries = entries.filter(e => e.entryDate >= start && e.entryDate < end);
  const totals = computeArtistBalanceTotals(cycleEntries);

  return {
    anchorDate,
    current: {
      index, startDate: start, endDate: end,
      displayEndDate: addDaysYmd(end, -1),
      daysUntilClose: daysBetweenYmd(today, end),
      totals,
    },
    closed,
  };
}

/** Closes the current open cycle: freezes its live totals into a permanent row.
 *  Guarded by the unique(artist_id, cycle_index) constraint, so a double-click (or
 *  a race) can never close the same cycle twice. Returns the fresh state.
 *
 *  Refuses an EARLY close (before the cycle's natural end date) unless `force` is
 *  true — the second half of the "don't let an accidental click close a cycle
 *  early" guard; the UI's own disabled-by-default button is the first half. */
export async function closeCurrentBalanceCycle(
  artistId: string,
  entries: ArtistBalanceEntry[],
  force = false,
): Promise<BalanceCycleState> {
  const state = await getBalanceCycleState(artistId, entries);
  if (!state.anchorDate || !state.current) throw new Error("לא הוגדר מחזור כספי עבור אמן זה");
  if (state.current.daysUntilClose > 0 && !force) {
    throw new Error(`המחזור טרם הסתיים (נותרו ${state.current.daysUntilClose} ימים) — יש לאשר סגירה מוקדמת באופן מפורש`);
  }

  const c = state.current;
  const { error } = await supabase.from("artist_balance_cycles").insert({
    artist_id: artistId,
    cycle_index: c.index,
    start_date: c.startDate,
    end_date: c.endDate,
    income: c.totals.income,
    expected_income: c.totals.expectedIncome,
    payments: c.totals.payments,
    expenses: c.totals.expenses,
    expected_expenses: c.totals.expectedExpenses,
    ending_balance: c.totals.currentBalance,
  });
  if (error) {
    if (error.code === "23505") throw new Error("המחזור כבר נסגר");
    throw new Error(error.message);
  }
  return getBalanceCycleState(artistId, entries);
}
