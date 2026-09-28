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
 *   a realized entitlement               → never changed or removed by a sync.
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
}

/** Keep the show's single entitlement row in step. Returns what happened (for tests / logs). */
export async function syncShowEntitlement(i: EntitlementSyncInput): Promise<"CREATED" | "UPDATED" | "UNCHANGED" | "MARKED_INACTIVE" | "REALIZED_UNTOUCHED" | "NONE"> {
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
  if (row && row.entry_type === REALIZED) return "REALIZED_UNTOUCHED";
  if (!i.stands || !(i.amount > 0)) {
    if (!row) return "NONE";
    if (isInactiveEntitlementNote(row.note as string | null)) return "UNCHANGED";
    const note = `${ENTITLEMENT_INACTIVE_MARK} ${i.inactiveReasonHe ?? "ההופעה בוטלה / אין שכר"} — הרשומה נשמרת (לא נמחקת)`;
    const { error: mErr } = await supabase.from("artist_balance_entries").update({ note, updated_at: new Date().toISOString() }).eq("id", row.id).eq("entry_type", EXPECTED);
    if (mErr) throw new Error(mErr.message);
    return "MARKED_INACTIVE";
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
    artist_id: i.artistId, entry_type: EXPECTED, amount: i.amount, entry_date: i.showDate ?? new Date().toISOString().slice(0, 10),
    description, note: "", source_show_id: i.showId,
  });
  if (iErr && iErr.code !== "23505") throw new Error(iErr.message); // 23505 = a concurrent sync created it — one row per show
  return "CREATED";
}

/**
 * Mark every still-EXPECTED entitlement of a show as not active (any artist; also a legacy row keyed by the old
 * artist-fee transaction). Used when the show is cancelled for good, reverted to a lead, deleted, or its artist no longer
 * has an agreement. Never deletes, never touches a realized entitlement.
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
  return n;
}
