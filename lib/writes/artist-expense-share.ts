/**
 * Keeps the artist ledger's EXPENSE SHARE of a Finance transaction in step — the ONE writer (Owner decision 2026-09-28,
 * task 6). The rule itself is lib/records-expense-share (pure); this file only reads the transaction + its project and
 * reconciles the ledger rows. Finance is never touched here (the full amount stays the Finance truth).
 *
 *   paid Records-artist expense (rule / Owner exception)  → one "הוצאות" row per artist = the artist's share
 *   the amount / date changed                             → the SAME row(s) are updated (never a second row)
 *   expected / cancelled / deleted / no longer applicable → the row is KEPT at amount 0, its note says why
 *                                                           ("[חלק הוצאה לא פעיל] …") — history is never deleted
 *   undefined (external party / no project …)            → nothing is written (never a guessed charge)
 *   recorded elsewhere (the Owner's lump row)             → nothing is written
 *
 * THE LINK (Owner-approved DB change 2026-09-28): artist_balance_entries.source_expense_tx_id → transactions(id), with the
 * partial UNIQUE index artist_balance_entries_expense_share_uk (source_expense_tx_id, artist_id). Every NEW share row —
 * both artists of a Shalev + Avi split — carries it, so the database itself refuses a second row for the same expense +
 * artist (a raced insert gets 23505 and continues with the existing row). Compatibility: rows written before the column
 * (linked by source_tx_id or the note marker "[חלק הוצאה tx:<id>]") are still found, updated and zeroed; a note marker
 * is never the key of a new row.
 */
import { supabase } from "@/lib/supabase";
import { expenseShareOf, markerTxIdOf, isDuplicateShareNote, INACTIVE_SHARE_PREFIX, type ExpenseShare } from "@/lib/records-expense-share";

const EXPENSE = "הוצאות";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ShareSyncResult { status: ExpenseShare["status"] | "TX_MISSING"; written: number; rows: Array<{ artistId: string; ledgerEntryId: string; amount: number; action: "CREATED" | "UPDATED" | "UNCHANGED" | "DEACTIVATED" }> }

type LedgerRow = { id: string; artist_id: string; entry_type: string; amount: number | string; entry_date: string | null; description: string | null; note: string | null; source_tx_id: string | null; source_expense_tx_id: string | null };
const COLS = "id, artist_id, entry_type, amount, entry_date, description, note, source_tx_id, source_expense_tx_id";

/** Every share row of a transaction: the canonical key, plus the legacy links (source_tx_id / note marker). */
async function shareRowsOf(txId: string): Promise<LedgerRow[]> {
  const [k, a, b] = await Promise.all([
    supabase.from("artist_balance_entries").select(COLS).eq("source_expense_tx_id", txId),
    supabase.from("artist_balance_entries").select(COLS).eq("source_tx_id", txId),
    supabase.from("artist_balance_entries").select(COLS).like("note", `%[חלק הוצאה tx:${txId}]%`),
  ]);
  for (const r of [k, a, b]) if (r.error) throw new Error(r.error.message);
  const out = new Map<string, LedgerRow>();
  for (const r of [...((k.data ?? []) as LedgerRow[]), ...((a.data ?? []) as LedgerRow[]), ...((b.data ?? []) as LedgerRow[])]) {
    if (r.entry_type === EXPENSE && (r.source_expense_tx_id === txId || r.source_tx_id === txId || markerTxIdOf(r.note) === txId)) out.set(r.id, r);
  }
  return [...out.values()];
}

const cleanNote = (note: string | null) => (note ?? "").replace(/^\[חלק הוצאה לא פעיל\][^|]*\|\s*/, "");
const zero = async (r: LedgerRow, why: string) => {
  const note = `${INACTIVE_SHARE_PREFIX} ${why} (היה ₪${round2(Number(r.amount) || 0)}) | ${cleanNote(r.note)}`;
  const { error } = await supabase.from("artist_balance_entries").update({ amount: 0, note, updated_at: new Date().toISOString() }).eq("id", r.id);
  if (error) throw new Error(error.message);
};

/** Bring the ledger share of ONE transaction in step with the rule. Idempotent: running it twice changes nothing. */
export async function syncExpenseShare(txId: string): Promise<ShareSyncResult> {
  const { data: tx, error } = await supabase.from("transactions").select("id, type, amount, currency, payment_status, business_unit, category, expense_scope, show_id, show_money_role, project_id, date, description").eq("id", txId).maybeSingle();
  if (error) throw new Error(error.message);
  const existing = await shareRowsOf(txId);
  const deactivate = async (why: string, status: ShareSyncResult["status"]): Promise<ShareSyncResult> => {
    const rows: ShareSyncResult["rows"] = [];
    for (const r of existing) {
      // a row linked to this transaction stops counting: kept, at 0, with the reason
      if (Number(r.amount) === 0 && (r.note ?? "").startsWith(INACTIVE_SHARE_PREFIX)) { rows.push({ artistId: r.artist_id, ledgerEntryId: r.id, amount: 0, action: "UNCHANGED" }); continue; }
      await zero(r, why);
      rows.push({ artistId: r.artist_id, ledgerEntryId: r.id, amount: 0, action: "DEACTIVATED" });
    }
    return { status, written: rows.filter((x) => x.action !== "UNCHANGED").length, rows };
  };
  if (!tx) return deactivate("ההוצאה נמחקה מהכספים", "TX_MISSING");
  let artistText: string | null = null;
  if (tx.project_id) {
    const { data: p, error: pErr } = await supabase.from("projects").select("artist").eq("id", tx.project_id).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    artistText = (p?.artist as string | null) ?? null;
  }
  const share = expenseShareOf({ id: tx.id, type: tx.type, amount: tx.amount, currency: tx.currency, paymentStatus: tx.payment_status, businessUnit: tx.business_unit, category: tx.category, expenseScope: tx.expense_scope, showId: tx.show_id, showMoneyRole: tx.show_money_role, projectId: tx.project_id }, tx.project_id ? { artistText } : null);
  if (share.status !== "DEFINED") return deactivate(share.reasonHe, share.status);
  if (!share.active) return deactivate(`ההוצאה לא שולמה / בוטלה (${tx.payment_status})`, "DEFINED");

  const rows: ShareSyncResult["rows"] = [];
  const date = (tx.date as string | null) ?? new Date().toISOString().slice(0, 10);
  const description = `חלק אמן בהוצאה — ${String(tx.description ?? "").slice(0, 120)}`;
  for (const a of share.artists) {
    // the canonical row first, then a legacy-linked row (adopted); a cancelled duplicate is never revived
    const mine = existing.filter((r) => r.artist_id === a.artistId && !isDuplicateShareNote(r.note));
    const row = mine.find((r) => r.source_expense_tx_id === txId) ?? mine.find((r) => r.source_tx_id === txId) ?? mine[0];
    if (row) {
      const wasInactive = (row.note ?? "").startsWith(INACTIVE_SHARE_PREFIX);
      // a legacy row takes the canonical key when free (so the DB guards it from now on)
      const takeKey = row.source_expense_tx_id !== txId && !existing.some((r) => r.source_expense_tx_id === txId && r.artist_id === a.artistId);
      if (!wasInactive && !takeKey && Number(row.amount) === a.amount && row.entry_date === date) { rows.push({ artistId: a.artistId, ledgerEntryId: row.id, amount: a.amount, action: "UNCHANGED" }); continue; }
      const note = wasInactive ? cleanNote(row.note) : (row.note ?? "");
      const { error: uErr } = await supabase.from("artist_balance_entries").update({ amount: a.amount, entry_date: date, note, ...(takeKey ? { source_expense_tx_id: txId } : {}), updated_at: new Date().toISOString() }).eq("id", row.id);
      if (uErr) throw new Error(uErr.message);
      rows.push({ artistId: a.artistId, ledgerEntryId: row.id, amount: a.amount, action: "UPDATED" });
      continue;
    }
    const { data: ins, error: iErr } = await supabase.from("artist_balance_entries").insert({
      artist_id: a.artistId, entry_type: EXPENSE, amount: a.amount, entry_date: date, description,
      note: share.basisHe, source_expense_tx_id: txId,
    }).select("id").single();
    if (iErr) {
      if (iErr.code === "23505") { // the DB key: a concurrent sync created this expense + artist row — use it, never a second
        const { data: again, error: aErr } = await supabase.from("artist_balance_entries").select("id, amount").eq("source_expense_tx_id", txId).eq("artist_id", a.artistId).limit(1);
        if (aErr) throw new Error(aErr.message);
        if (again && again.length) { rows.push({ artistId: a.artistId, ledgerEntryId: String(again[0].id), amount: Number(again[0].amount) || 0, action: "UNCHANGED" }); continue; }
      }
      throw new Error(iErr.message);
    }
    rows.push({ artistId: a.artistId, ledgerEntryId: String(ins!.id), amount: a.amount, action: "CREATED" });
  }
  // a row of an artist the rule no longer names (e.g. the project credits changed) → zeroed, kept
  for (const r of existing) if (!share.artists.some((a) => a.artistId === r.artist_id) && Number(r.amount) !== 0 && (r.source_expense_tx_id === txId || markerTxIdOf(r.note) === txId)) {
    await zero(r, "החוק כבר לא מחייב את האמן הזה");
    rows.push({ artistId: r.artist_id, ledgerEntryId: r.id, amount: 0, action: "DEACTIVATED" });
  }
  return { status: "DEFINED", written: rows.filter((x) => x.action !== "UNCHANGED").length, rows };
}

/**
 * LEGACY rows only (written before the DB key, linked by the note marker): the earliest row of (transaction, artist)
 * wins and a later duplicate is set to 0 with a note. New rows never need it — the unique key refuses a duplicate.
 */
export async function convergeDuplicateShare(txId: string, artistId: string, mine: string): Promise<string> {
  const rows = (await shareRowsOf(txId)).filter((r) => r.artist_id === artistId);
  if (rows.length <= 1) return mine;
  const { data, error } = await supabase.from("artist_balance_entries").select("id, created_at").in("id", rows.map((r) => r.id));
  if (error) throw new Error(error.message);
  const at = new Map(((data ?? []) as Array<{ id: string; created_at: string | null }>).map((r) => [r.id, String(r.created_at ?? "")]));
  const sorted = [...rows].sort((a, b) => (at.get(a.id) ?? "").localeCompare(at.get(b.id) ?? "") || a.id.localeCompare(b.id));
  const winner = sorted[0].id;
  if (mine !== winner) {
    const cur = rows.find((r) => r.id === mine);
    if (cur) await zero(cur, `כפילות מקבילה של אותו חלק אמן (${winner}) — נשמרת ב-0`);
  }
  return winner;
}

/**
 * The same, never throwing — for the Finance writers: the Finance row is the truth and is already saved; a failed share
 * sync is logged and shows up in the reconciliation (SHARE_MISSING / SHARE_AMOUNT_MISMATCH) until the next sync.
 */
export async function syncExpenseShareSafe(txId: string | null | undefined): Promise<ShareSyncResult | null> {
  if (!txId) return null;
  try { return await syncExpenseShare(txId); }
  catch (e) { console.error(`[artist-expense-share] sync ${txId} failed:`, e instanceof Error ? e.message : e); return null; }
}

/** Re-sync every expense of a project (its credits changed → the artists who carry its expenses may change). */
export async function syncProjectExpenseShares(projectId: string): Promise<number> {
  const { data, error } = await supabase.from("transactions").select("id").eq("project_id", projectId).eq("type", "expense");
  if (error) throw new Error(error.message);
  let n = 0;
  for (const t of (data ?? []) as Array<{ id: string }>) { const r = await syncExpenseShareSafe(t.id); n += r?.written ?? 0; }
  return n;
}
