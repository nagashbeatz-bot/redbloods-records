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
 * Link (no schema change): every row it writes carries the marker "[חלק הוצאה tx:<id>]" in its note, and the FIRST
 * artist's row also takes artist_balance_entries.source_tx_id (UNIQUE — a retry can never add a second such row).
 * A row the Owner already linked by source_tx_id (ACUM, ISSA) is adopted, never duplicated. Limitation: the second artist
 * of a two-artist split is linked by the note marker only (no DB-unique key) — the reconciliation reports a duplicate.
 */
import { supabase } from "@/lib/supabase";
import { expenseShareOf, expenseShareMarker, markerTxIdOf, INACTIVE_SHARE_PREFIX, type ExpenseShare } from "@/lib/records-expense-share";

const EXPENSE = "הוצאות";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ShareSyncResult { status: ExpenseShare["status"] | "TX_MISSING"; written: number; rows: Array<{ artistId: string; ledgerEntryId: string; amount: number; action: "CREATED" | "UPDATED" | "UNCHANGED" | "DEACTIVATED" }> }

type LedgerRow = { id: string; artist_id: string; entry_type: string; amount: number | string; entry_date: string | null; description: string | null; note: string | null; source_tx_id: string | null };

async function shareRowsOf(txId: string): Promise<LedgerRow[]> {
  const cols = "id, artist_id, entry_type, amount, entry_date, description, note, source_tx_id";
  const [a, b] = await Promise.all([
    supabase.from("artist_balance_entries").select(cols).eq("source_tx_id", txId),
    supabase.from("artist_balance_entries").select(cols).like("note", `%${expenseShareMarker(txId)}%`),
  ]);
  if (a.error) throw new Error(a.error.message);
  if (b.error) throw new Error(b.error.message);
  const out = new Map<string, LedgerRow>();
  for (const r of [...((a.data ?? []) as LedgerRow[]), ...((b.data ?? []) as LedgerRow[])]) if (r.entry_type === EXPENSE && (r.source_tx_id === txId || markerTxIdOf(r.note) === txId)) out.set(r.id, r);
  return [...out.values()];
}

const cleanNote = (note: string | null) => (note ?? "").replace(/^\[חלק הוצאה לא פעיל\][^|]*\|\s*/, "");

/** Bring the ledger share of ONE transaction in step with the rule. Idempotent: running it twice changes nothing. */
export async function syncExpenseShare(txId: string): Promise<ShareSyncResult> {
  const { data: tx, error } = await supabase.from("transactions").select("id, type, amount, currency, payment_status, business_unit, category, expense_scope, show_id, show_money_role, project_id, date, description").eq("id", txId).maybeSingle();
  if (error) throw new Error(error.message);
  const existing = await shareRowsOf(txId);
  const deactivate = async (why: string, status: ShareSyncResult["status"]): Promise<ShareSyncResult> => {
    const rows: ShareSyncResult["rows"] = [];
    for (const r of existing) {
      // a row linked to this transaction (marker or source_tx_id) stops counting: kept, at 0, with the reason
      if (Number(r.amount) === 0 && (r.note ?? "").startsWith(INACTIVE_SHARE_PREFIX)) { rows.push({ artistId: r.artist_id, ledgerEntryId: r.id, amount: 0, action: "UNCHANGED" }); continue; }
      const note = `${INACTIVE_SHARE_PREFIX} ${why} (היה ₪${round2(Number(r.amount) || 0)}) | ${cleanNote(r.note)}`;
      const { error: uErr } = await supabase.from("artist_balance_entries").update({ amount: 0, note, updated_at: new Date().toISOString() }).eq("id", r.id);
      if (uErr) throw new Error(uErr.message);
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
  if (share.status !== "DEFINED") return deactivate(share.status === "NOT_APPLICABLE" ? share.reasonHe : share.reasonHe, share.status);
  if (!share.active) return deactivate(`ההוצאה לא שולמה / בוטלה (${tx.payment_status})`, "DEFINED");

  const rows: ShareSyncResult["rows"] = [];
  const marker = expenseShareMarker(txId);
  const date = (tx.date as string | null) ?? new Date().toISOString().slice(0, 10);
  const description = `חלק אמן בהוצאה — ${String(tx.description ?? "").slice(0, 120)}`;
  const firstArtist = share.artists[0]?.artistId ?? null;
  for (const a of share.artists) {
    const mine = existing.filter((r) => r.artist_id === a.artistId);
    const row = mine.find((r) => r.source_tx_id === txId) ?? mine[0];
    if (row) {
      const wasInactive = (row.note ?? "").startsWith(INACTIVE_SHARE_PREFIX);
      if (!wasInactive && Number(row.amount) === a.amount && row.entry_date === date) { rows.push({ artistId: a.artistId, ledgerEntryId: row.id, amount: a.amount, action: "UNCHANGED" }); continue; }
      const note = wasInactive ? cleanNote(row.note) : (row.note ?? "");
      const { error: uErr } = await supabase.from("artist_balance_entries").update({ amount: a.amount, entry_date: date, note, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (uErr) throw new Error(uErr.message);
      rows.push({ artistId: a.artistId, ledgerEntryId: row.id, amount: a.amount, action: "UPDATED" });
      continue;
    }
    // the first artist takes source_tx_id (UNIQUE) unless an Owner row already holds it
    const takesKey = a.artistId === firstArtist && !existing.some((r) => r.source_tx_id === txId);
    const { data: ins, error: iErr } = await supabase.from("artist_balance_entries").insert({
      artist_id: a.artistId, entry_type: EXPENSE, amount: a.amount, entry_date: date, description,
      note: `${marker} ${share.basisHe}`, source_tx_id: takesKey ? txId : null,
    }).select("id").single();
    if (iErr) {
      if (iErr.code === "23505") { // a concurrent sync created it — re-read, never a second row
        const again = (await shareRowsOf(txId)).find((r) => r.artist_id === a.artistId);
        if (again) { rows.push({ artistId: a.artistId, ledgerEntryId: again.id, amount: Number(again.amount) || 0, action: "UNCHANGED" }); continue; }
      }
      throw new Error(iErr.message);
    }
    rows.push({ artistId: a.artistId, ledgerEntryId: String(ins!.id), amount: a.amount, action: "CREATED" });
  }
  // a marker row of an artist the rule no longer names (e.g. the project credits changed) → zeroed, kept
  for (const r of existing) if (!share.artists.some((a) => a.artistId === r.artist_id) && markerTxIdOf(r.note) === txId && Number(r.amount) !== 0) {
    const note = `${INACTIVE_SHARE_PREFIX} החוק כבר לא מחייב את האמן הזה (היה ₪${round2(Number(r.amount) || 0)}) | ${cleanNote(r.note)}`;
    const { error: uErr } = await supabase.from("artist_balance_entries").update({ amount: 0, note, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (uErr) throw new Error(uErr.message);
    rows.push({ artistId: r.artist_id, ledgerEntryId: r.id, amount: 0, action: "DEACTIVATED" });
  }
  return { status: "DEFINED", written: rows.filter((x) => x.action !== "UNCHANGED").length, rows };
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
