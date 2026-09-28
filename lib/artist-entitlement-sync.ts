import "server-only";
/**
 * The artist's SHOW ENTITLEMENT in the ledger (net settlement model, Owner decision 2026-09-28).
 *
 * A show share is an entitlement, never a Finance expense. For an agreement artist (lib/label-agreements — שליו / אבי
 * by the roster; any other artist or a collab is NOT_DEFINED and gets nothing) the show sync keeps ONE earning row per
 * show + artist in artist_balance_entries (source_show_id — unique with the artist for the earning types):
 *   a confirmed, not-yet-performed show → "הכנסות צפויות" (future entitlement, never in the balance)
 *   the show performed and closed      → the close sync (lib/artist-balance-show-close-sync) turns the SAME row into
 *                                        "הכנסות" (a real entitlement in the balance)
 *   the show cancelled / fee 0          → the expected row is marked NOT ACTIVE by its note (never deleted — the ledger
 *                                        has no status column; a schema change was not approved). Readers exclude it.
 *   a realized entitlement               → (A7, Final Hardening 2026-09-29) the SAME row follows the show:
 *                                          a price change re-prices it; a cancel / revert / delete keeps it at
 *                                          amount 0 with the reason and what it was (never deleted — CHECK amount >= 0);
 *                                          performed again → restored. A plain edit to בוצע realizes it (not only
 *                                          the close dialog). No second row, no double count.
 * The amount is the app's own split (computeShowSplit via showAgreementSplit) — no second rule. The ledger stores no
 * currency: only a ₪ show is synced.
 */
import { supabase } from "@/lib/supabase";
import { INACTIVE_ENTITLEMENT_PREFIX } from "@/lib/finance/unit-balance";

/** The note prefix that marks an expected entitlement as not active (its show was cancelled / has no fee) — ONE source. */
export const ENTITLEMENT_INACTIVE_MARK = INACTIVE_ENTITLEMENT_PREFIX;
export const isInactiveEntitlementNote = (note: string | null | undefined) => (note ?? "").startsWith(ENTITLEMENT_INACTIVE_MARK);
const EXPECTED = "הכנסות צפויות";
const REALIZED = "הכנסות";

export interface EntitlementSyncInput {
  showId: string;
  showName: string;
  showDate: string | null;
  artistId: string;              // the agreement artist (label_artists id)
  amount: number;                // the artist's share (showAgreementSplit)
  stands: boolean;               // confirmed, not cancelled, share > 0
  legacyTxId?: string | null;    // a legacy booking-time row keyed by the old artist-fee transaction
  inactiveReasonHe?: string;
  /** the show was PERFORMED (status בוצע, not cancelled) → the entitlement is realized ("הכנסות") — A7 */
  performed?: boolean;
}

/** The zeroed note keeps the row's earlier note after " || " (history is never lost); restoring brings it back. */
const NOTE_KEEP = " || ";
const zeroNote = (reasonHe: string, was: number, prev: string | null | undefined) => {
  const earlier = prev && !isInactiveEntitlementNote(prev) ? `${NOTE_KEEP}${prev}` : "";
  return `${ENTITLEMENT_INACTIVE_MARK} ${reasonHe} (היה ₪${Math.round(was * 100) / 100}) — הרשומה נשמרת (לא נמחקת)${earlier}`;
};
const restoredNote = (note: string | null | undefined) => { const n = String(note ?? ""); const k = n.indexOf(NOTE_KEEP); return k >= 0 ? n.slice(k + NOTE_KEEP.length) : ""; };

/** Keep the show's single entitlement row in step. Returns what happened (for tests / logs). */
export async function syncShowEntitlement(i: EntitlementSyncInput): Promise<"CREATED" | "UPDATED" | "UNCHANGED" | "MARKED_INACTIVE" | "REALIZED_UNTOUCHED" | "REALIZED" | "REALIZED_REPRICED" | "REALIZED_ZEROED" | "NONE"> {
  const description = `הופעה - ${i.showName}`;
  const { data: byShow, error } = await supabase.from("artist_balance_entries").select("id, entry_type, amount, entry_date, description, note, source_show_id")
    .eq("source_show_id", i.showId).eq("artist_id", i.artistId).in("entry_type", [EXPECTED, REALIZED]).limit(1);
  if (error) throw new Error(error.message);
  let row = byShow && byShow.length ? byShow[0] : null;
  if (!row && i.legacyTxId) {
    // adopt a legacy booking-time row (keyed by the old artist-fee transaction): link it to the show, keep its id
    const { data: legacy, error: lErr } = await supabase.from("artist_balance_entries").select("id, entry_type, amount, entry_date, description, note, source_show_id")
      .eq("source_tx_id", i.legacyTxId).eq("artist_id", i.artistId).in("entry_type", [EXPECTED, REALIZED]).limit(1);
    if (lErr) throw new Error(lErr.message);
    if (legacy && legacy.length) {
      row = legacy[0];
      if (!row.source_show_id) {
        const { error: aErr } = await supabase.from("artist_balance_entries").update({ source_show_id: i.showId, updated_at: new Date().toISOString() }).eq("id", row.id).is("source_show_id", null);
        if (aErr) throw new Error(aErr.message);
      }
    }
  }
  if (row && row.entry_type === REALIZED) {
    const inactive = isInactiveEntitlementNote(row.note as string | null);
    if (!i.stands || !(i.amount > 0)) {
      // A7: cancelled (or no share any more) after it was realized → the SAME row is kept at 0 with the reason
      if (inactive && Number(row.amount) === 0) return "UNCHANGED";
      const { error: zErr } = await supabase.from("artist_balance_entries").update({ amount: 0, note: zeroNote(i.inactiveReasonHe ?? "ההופעה בוטלה", Number(row.amount) || 0, row.note as string | null), updated_at: new Date().toISOString() }).eq("id", row.id).eq("entry_type", REALIZED);
      if (zErr) throw new Error(zErr.message);
      return "REALIZED_ZEROED";
    }
    if (!i.performed && !inactive) return "REALIZED_UNTOUCHED"; // a realized row is never demoted to expected by a sync
    if (!inactive && Number(row.amount) === i.amount) return "UNCHANGED";
    // A7: the price / split changed after realization (or it was zeroed and the show stands again) → the SAME row
    const { error: rErr } = await supabase.from("artist_balance_entries").update({ amount: i.amount, ...(inactive ? { note: restoredNote(row.note as string | null) } : {}), updated_at: new Date().toISOString() }).eq("id", row.id).eq("entry_type", REALIZED);
    if (rErr) throw new Error(rErr.message);
    return "REALIZED_REPRICED";
  }
  if (!i.stands || !(i.amount > 0)) {
    if (!row) return "NONE";
    if (isInactiveEntitlementNote(row.note as string | null)) return "UNCHANGED";
    const note = `${ENTITLEMENT_INACTIVE_MARK} ${i.inactiveReasonHe ?? "ההופעה בוטלה / אין שכר"} — הרשומה נשמרת (לא נמחקת)`;
    const { error: mErr } = await supabase.from("artist_balance_entries").update({ note, updated_at: new Date().toISOString() }).eq("id", row.id).eq("entry_type", EXPECTED);
    if (mErr) throw new Error(mErr.message);
    return "MARKED_INACTIVE";
  }
  if (row && i.performed) {
    // A7: the show was performed → the SAME expected row becomes the realized entitlement (never a second row)
    const { error: pErr } = await supabase.from("artist_balance_entries").update({
      entry_type: REALIZED, amount: i.amount, entry_date: i.showDate ?? row.entry_date, description, ...(isInactiveEntitlementNote(row.note as string | null) ? { note: "" } : {}), updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("entry_type", EXPECTED);
    if (pErr) throw new Error(pErr.message);
    return "REALIZED";
  }
  if (row) {
    const wasInactive = isInactiveEntitlementNote(row.note as string | null);
    if (!wasInactive && Number(row.amount) === i.amount && row.entry_date === (i.showDate ?? row.entry_date) && row.description === description) return "UNCHANGED";
    const { error: uErr } = await supabase.from("artist_balance_entries").update({
      amount: i.amount, entry_date: i.showDate ?? row.entry_date, description, ...(wasInactive ? { note: "" } : {}), updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("entry_type", EXPECTED); // never rewrites a row that was realized meanwhile
    if (uErr) throw new Error(uErr.message);
    return "UPDATED";
  }
  const { error: iErr } = await supabase.from("artist_balance_entries").insert({
    artist_id: i.artistId, entry_type: i.performed ? REALIZED : EXPECTED, amount: i.amount, entry_date: i.showDate ?? new Date().toISOString().slice(0, 10),
    description, note: "", source_show_id: i.showId,
  });
  if (iErr && iErr.code !== "23505") throw new Error(iErr.message); // 23505 = a concurrent sync created it — one row per show
  return i.performed ? "REALIZED" : "CREATED";
}

/**
 * Mark every still-EXPECTED entitlement of a show as not active (any artist; also a legacy row keyed by the old
 * artist-fee transaction). Used when the show is cancelled for good, reverted to a lead, deleted, or its artist no longer
 * has an agreement. Never deletes. A7 (2026-09-29): a REALIZED entitlement of that show is kept at amount 0 with the
 * reason and what it was (it no longer counts — never a double count, never deleted).
 */
export async function markShowEntitlementsInactive(showId: string, reasonHe: string, legacyTxId?: string | null): Promise<number> {
  const { data: byShow, error } = await supabase.from("artist_balance_entries").select("id, note").eq("source_show_id", showId).eq("entry_type", EXPECTED);
  if (error) throw new Error(error.message);
  let rows = byShow ?? [];
  if (legacyTxId) {
    const { data: legacy, error: lErr } = await supabase.from("artist_balance_entries").select("id, note").eq("source_tx_id", legacyTxId).eq("entry_type", EXPECTED);
    if (lErr) throw new Error(lErr.message);
    rows = [...rows, ...(legacy ?? []).filter((l) => !rows.some((r) => r.id === l.id))];
  }
  let n = 0;
  for (const r of rows) {
    if (isInactiveEntitlementNote(r.note as string | null)) continue;
    const { error: mErr } = await supabase.from("artist_balance_entries").update({ note: `${ENTITLEMENT_INACTIVE_MARK} ${reasonHe} — הרשומה נשמרת (לא נמחקת)`, updated_at: new Date().toISOString() }).eq("id", r.id).eq("entry_type", EXPECTED);
    if (mErr) throw new Error(mErr.message);
    n++;
  }
  const { data: realized, error: rErr } = await supabase.from("artist_balance_entries").select("id, note, amount").eq("source_show_id", showId).eq("entry_type", REALIZED);
  if (rErr) throw new Error(rErr.message);
  for (const r of realized ?? []) {
    if (isInactiveEntitlementNote(r.note as string | null) && Number(r.amount) === 0) continue;
    const { error: zErr } = await supabase.from("artist_balance_entries").update({ amount: 0, note: zeroNote(reasonHe, Number(r.amount) || 0, r.note as string | null), updated_at: new Date().toISOString() }).eq("id", r.id).eq("entry_type", REALIZED);
    if (zErr) throw new Error(zErr.message);
    n++;
  }
  return n;
}
