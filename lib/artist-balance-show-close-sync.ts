import "server-only";
import { supabase } from "./supabase";
import { getLabelArtistByName } from "./label-artists-store";
import { singleArtistToken } from "./artist-balance-show-sync-pure";
import type { Show } from "./shows-types";

/**
 * Realized income + payment sync for a CLOSED show ("בוצע" + the close-show
 * modal confirmed) — distinct from lib/artist-balance-show-sync.ts, which only
 * ever creates "הכנסות צפויות" at booking time, Shalev-only. This file:
 *
 *  • recognizes the artist's share as REAL "הכנסות" the moment a show closes,
 *    regardless of whether the label has actually paid the artist yet
 *    (accrual, not cash);
 *  • generic — works for ANY show whose `artist` name resolves to a real
 *    label_artists row. There is no stable id linking shows.artist_client_id
 *    (→ clients) to label_artists (verified: neither table has any column
 *    referencing the other) — so this uses the SAME name-resolution the other
 *    sync already uses, minus its Shalev-only allowlist. Ambiguous (collab) or
 *    unresolvable names are SKIPPED, never guessed, and always logged clearly
 *    so a mismatch can never silently attribute money to the wrong artist;
 *  • ONE earning row per show, ever — it starts as "הכנסות צפויות" (via the
 *    other sync, if that already ran) and this file PROMOTES that exact row to
 *    "הכנסות" in place. There is never a moment where both an expected and a
 *    realized row exist for the same show;
 *  • payments are a SEPARATE, unconstrained concept — a show can accumulate
 *    zero, one, or several "תשלומים" rows over time (same-day, later,
 *    consolidated across shows, installments…), exactly like the general
 *    manual ledger already allows. source_show_id on a payment row is only a
 *    soft traceability/idempotency hint for the close-modal's OWN checkbox —
 *    never a hard constraint — so it never limits the general payments flow.
 *
 * Idempotency:
 *   - Earning: artist_balance_entries.source_show_id (+ artist_id) is UNIQUE
 *     among rows whose entry_type is "הכנסות" or "הכנסות צפויות" (partial
 *     index) — so a show can never end up with two earning rows, in any
 *     combination of states. The pre-existing source_tx_id (the OTHER sync's
 *     key) is checked first so a row it already created is found and
 *     promoted/linked, never duplicated.
 *   - Payment: NOT enforced at the DB level (deliberately — see above). The
 *     close-modal's own "שולם לאמן" checkbox is idempotent at the application
 *     level only (looks for a payment row already tagged with this show's id
 *     before creating another), so re-saving the same close action twice
 *     doesn't double-pay; a genuinely separate/later payment is unaffected.
 *
 * Failure handling: every function here THROWS on a real DB error (including a
 * failed lookup, not just a failed write) — nothing is swallowed internally.
 * The caller (app/api/shows/[id]/route.ts) treats a thrown error as the whole
 * close-show request having FAILED (never a silent 200 with the show already
 * marked "בוצע" but its income unrecorded), and every write here is
 * idempotent lookup-before-write — so retrying the exact same close action
 * after a partial failure always converges to the correct single-row state,
 * never a duplicate.
 */

function showIncomeDescription(show: Show): string {
  return `הופעה - ${show.name}`;
}

export type ArtistResolution =
  | { status: "resolved"; artistId: string }
  | { status: "skipped"; reason: "empty" | "collab" | "not_found" };
export type ArtistResolutionSkipReason = Extract<ArtistResolution, { status: "skipped" }>["reason"];

/** Resolve the show's single, unambiguous label-artist id. Never guesses: a
 *  collab (multiple tokens), an empty artist field, or a name with no exact
 *  label_artists match all come back as an explicit, logged skip — no income
 *  is ever attributed to the wrong artist. */
export async function resolveShowArtistId(showArtist: string): Promise<ArtistResolution> {
  const raw = (showArtist ?? "").trim();
  const token = singleArtistToken(showArtist);
  if (!token) return { status: "skipped", reason: raw ? "collab" : "empty" };
  const artist = await getLabelArtistByName(token);
  if (!artist) return { status: "skipped", reason: "not_found" };
  return { status: "resolved", artistId: artist.id };
}

/** Logs a clear, specific skip reason — called by every caller that gets a
 *  "skipped" resolution, so an unmatched show is never silently ignored. */
export function logArtistResolutionSkip(show: Pick<Show, "id" | "name" | "artist">, reason: ArtistResolutionSkipReason): void {
  const why = reason === "empty" ? "no artist set on the show"
    : reason === "collab" ? `collab show ("${show.artist}") — ambiguous, no single artist to attribute the fee to`
    : `artist name "${show.artist}" does not match any registered label artist`;
  console.warn(`[artist-balance-show-close-sync] show ${show.id} ("${show.name}") — SKIPPED, no balance entry written: ${why}`);
}

/** Realizes the artist's share of a closed show as "הכנסות", dated to the
 *  show's own date (never the closing date). Promotes the SAME row the other
 *  sync may have already created for this show ("הכנסות צפויות") instead of
 *  ever creating a second one — there is at most one earning row per show. */
export async function syncArtistIncomeFromClosedShow(params: {
  artistId: string;
  show: Show;
  amount: number;
}): Promise<void> {
  const { artistId, show, amount } = params;
  if (amount <= 0) return; // nothing to record
  const entryDate = show.date ?? new Date().toISOString().slice(0, 10);
  const description = showIncomeDescription(show);

  // 1) Already linked directly to this show (+ this artist — matches the
  //    (source_show_id, artist_id) unique index) — the ONE earning row, in
  //    whichever state it's currently in. Promote/refresh it.
  const { data: bySho, error: byShoErr } = await supabase
    .from("artist_balance_entries")
    .select("id")
    .eq("source_show_id", show.id).eq("artist_id", artistId).in("entry_type", ["הכנסות", "הכנסות צפויות"]).maybeSingle();
  if (byShoErr) throw new Error(`[income] lookup by source_show_id failed: ${byShoErr.message}`);
  if (bySho?.id) {
    const { error } = await supabase.from("artist_balance_entries")
      .update({ entry_type: "הכנסות", amount, entry_date: entryDate, description, updated_at: new Date().toISOString() })
      .eq("id", bySho.id);
    if (error) throw new Error(`[income] update (by source_show_id) failed: ${error.message}`);
    return;
  }

  // 2) Not yet linked by source_show_id — the OTHER (booking-time) sync may
  //    have already created a row keyed by the artist-fee transaction id.
  //    Promote + link THAT row rather than creating a parallel one.
  const txId = show.linked_artist_expense_transaction_id;
  if (txId) {
    const { data: byTx, error: byTxErr } = await supabase
      .from("artist_balance_entries")
      .select("id").eq("source_tx_id", txId).maybeSingle();
    if (byTxErr) throw new Error(`[income] lookup by source_tx_id failed: ${byTxErr.message}`);
    if (byTx?.id) {
      const { error } = await supabase.from("artist_balance_entries")
        .update({ entry_type: "הכנסות", amount, entry_date: entryDate, description, source_show_id: show.id, updated_at: new Date().toISOString() })
        .eq("id", byTx.id);
      if (error) throw new Error(`[income] convert (by source_tx_id) failed: ${error.message}`);
      return;
    }
  }

  // 3) Nothing exists yet — insert fresh. A 23505 here means a concurrent call
  //    already created the row (the unique index is the real guarantee) —
  //    that still means "an earning row now exists", so it's not a failure.
  const { error } = await supabase.from("artist_balance_entries").insert({
    artist_id: artistId, entry_type: "הכנסות", amount, entry_date: entryDate,
    description, note: "", source_show_id: show.id,
  });
  if (error && error.code !== "23505") throw new Error(`[income] insert failed: ${error.message}`);
}

/** Whether a payment row already exists for this show (from a prior save of
 *  the close-modal's "שולם לאמן" checkbox) — used both to avoid double-paying
 *  on re-save AND to warn the owner if they later uncheck it (see the route).
 *  Payments are explicitly UNLIMITED per show (see module doc) — a show can
 *  end up with several (installments, a manually added consolidated payment,
 *  etc.), so this must tolerate 2+ rows and just report the most recent one;
 *  it must NEVER use .maybeSingle(), which throws on more than one match. */
export async function findShowPaymentEntry(showId: string): Promise<{ id: string; amount: number; entryDate: string } | null> {
  const { data, error } = await supabase
    .from("artist_balance_entries")
    .select("id, amount, entry_date")
    .eq("source_show_id", showId).eq("entry_type", "תשלומים")
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`[payment] lookup by source_show_id failed: ${error.message}`);
  const row = data?.[0];
  return row ? { id: row.id, amount: Number(row.amount) || 0, entryDate: row.entry_date } : null;
}

/** Creates a real payment ("תשלומים") for a closed show, dated to the payment
 *  date the owner chose. Idempotent ONLY with respect to the close-modal's own
 *  checkbox (won't double-create on re-save) — this is a soft, application-
 *  level check, never a DB constraint, so it never limits the general
 *  standalone/consolidated payments flow elsewhere in the ledger. */
export async function createShowArtistPayment(params: {
  artistId: string;
  show: Show;
  amount: number;
  paymentDate: string;
}): Promise<void> {
  const { artistId, show, amount, paymentDate } = params;
  if (amount <= 0) return;
  const already = await findShowPaymentEntry(show.id); // throws on lookup failure
  if (already) return; // this show's close-modal payment was already recorded
  const description = showIncomeDescription(show);
  const { error } = await supabase.from("artist_balance_entries").insert({
    artist_id: artistId, entry_type: "תשלומים", amount, entry_date: paymentDate,
    description, note: "", source_show_id: show.id,
  });
  if (error) throw new Error(`[payment] insert failed: ${error.message}`);
}
