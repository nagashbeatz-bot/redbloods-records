import "server-only";
import { supabase } from "./supabase";
import { getLabelArtistByName } from "./label-artists-store";
import { singleArtistToken, AUTO_SYNC_ENTRY_TYPE, decideSyncAction, decideRemovalAction } from "./artist-balance-show-sync-pure";

/**
 * Live (one-way, read-derived) sync: a show's artist-fee transaction
 * (transactions.category="שכר אמן", linked via shows.linked_artist_expense_transaction_id)
 * → a matching row in the manual artist_balance_entries ledger.
 *
 * The automatic sync ALWAYS stops at "הכנסות צפויות" — regardless of the
 * transaction's payment_status (שולם or צפוי). It NEVER creates or promotes a
 * row to "הכנסות" on its own; that transition is manual-only, via the balance
 * page's "סמן כהתקבל" action. This is a deliberate business decision — the
 * automatic sync's job ends at "there's an expected show fee", not "the money
 * arrived" (only a human confirms that).
 *
 * Phase 1 — Shalev only (explicit allowlist below); no other artist, no Avi.
 *
 * Idempotency: source_tx_id = the artist-fee transaction's id, protected by the
 * EXISTING partial unique index `artist_balance_entries_source_tx_uk`
 * (UNIQUE (source_tx_id) WHERE source_tx_id IS NOT NULL — verified live in
 * production before this file was written, not assumed). The write pattern is
 * INSERT-first, and ONLY a 23505 (unique_violation) triggers a follow-up
 * read+UPDATE — never a pre-check SELECT before the insert attempt. Any other
 * error is logged explicitly (never silently treated as success).
 *
 * Protection: once a synced entry is "הכנסות" (marked received — manually,
 * via "סמן כהתקבל"), it is FROZEN — a later show edit never reverts it to
 * "הכנסות צפויות", never changes its amount/date/description, and never
 * deletes it. Only a still-"הכנסות צפויות" entry is ever updated or removed.
 * All branching decisions ("insert vs update vs skip", "delete vs keep") live
 * in the pure, tested lib/artist-balance-show-sync-pure.ts — this file only
 * does the DB I/O.
 */

// Phase-1 allowlist — resolved artist_id must be one of these, or the show is
// skipped entirely (no write). No fallback to Shalev on ambiguity — the id
// must come from an exact, unambiguous canonical name resolution below.
const SYNC_ENABLED_ARTIST_IDS = new Set<string>([
  "8806fe5e-1238-4228-8078-b3db3ccc9b46", // שליו טסמה
]);

/**
 * Resolve a show's `artist` field to a phase-1-enabled label artist id, or
 * null. Unambiguous only: the field must contain EXACTLY ONE artist token
 * (singleArtistToken — a collab show is ambiguous and is skipped, never
 * partially attributed). That single token must be an EXACT match
 * (getLabelArtistByName — the same canonical, case-sensitive, no-fuzzy lookup
 * used by resolvePortalConfigByName and every other server-side Shalev
 * resolution in this codebase).
 */
async function resolveSyncEnabledArtistId(showArtist: string): Promise<string | null> {
  const token = singleArtistToken(showArtist);
  if (!token) return null; // empty or collab — ambiguous
  const artist = await getLabelArtistByName(token);
  if (!artist) return null; // not a registered label artist
  if (!SYNC_ENABLED_ARTIST_IDS.has(artist.id)) return null; // registered but not phase-1-enabled
  return artist.id;
}

/**
 * Create-or-update the synced ledger entry for an ACTIVE (non-cancelled)
 * artist-fee transaction — ALWAYS as "הכנסות צפויות" (see module doc; the
 * transaction's payment_status is irrelevant here, on purpose). Call this
 * only when the transaction represents a real, still-standing fee — never
 * for "בוטל" (use removeSyncedArtistBalanceEntry for that).
 */
export async function syncArtistBalanceFromShow(params: {
  showArtist: string;
  showName: string;
  showDate: string | null;
  transactionId: string;
  amount: number;
}): Promise<void> {
  try {
    const artistId = await resolveSyncEnabledArtistId(params.showArtist);
    if (!artistId) return; // not Shalev / ambiguous / unregistered — silently out of scope

    const entryDate = params.showDate ?? new Date().toISOString().slice(0, 10);
    const description = `הופעה - ${params.showName}`;

    // INSERT first — no pre-check SELECT. The partial unique index on
    // source_tx_id (verified live) is the sole conflict authority.
    const { error: insertErr } = await supabase.from("artist_balance_entries").insert({
      artist_id: artistId,
      entry_type: AUTO_SYNC_ENTRY_TYPE,
      amount: params.amount,
      entry_date: entryDate,
      description,
      note: "",
      source_tx_id: params.transactionId,
    });
    if (!insertErr) return; // created — done

    if (insertErr.code !== "23505") {
      console.error(`[artist-balance-show-sync] insert failed for tx ${params.transactionId}:`, insertErr.message);
      return; // explicit failure — NOT treated as success
    }

    // A row for this transaction already exists (this run, or a concurrent
    // one) — look it up and let the pure decision function say what's safe.
    const { data: existing, error: readErr } = await supabase
      .from("artist_balance_entries")
      .select("id, entry_type")
      .eq("source_tx_id", params.transactionId)
      .maybeSingle();
    if (readErr) {
      console.error(`[artist-balance-show-sync] post-conflict read failed for tx ${params.transactionId}:`, readErr.message);
      return;
    }
    const decision = decideSyncAction(existing);
    if (decision.action !== "update") {
      if (decision.action === "skip_already_received") {
        console.log(`[artist-balance-show-sync] skip: tx ${params.transactionId} entry already marked הכנסות (manually confirmed) — not touched`);
      } else {
        // "insert" here means the post-conflict read found nothing — a genuine
        // inconsistency (the 23505 said a row exists), report it explicitly.
        console.error(`[artist-balance-show-sync] post-conflict row missing for tx ${params.transactionId} despite 23505`);
      }
      return;
    }

    // Still "הכנסות צפויות" — safe to refresh amount/date/description. entry_type
    // stays AUTO_SYNC_ENTRY_TYPE (never promoted to הכנסות by this function).
    const { error: updateErr } = await supabase
      .from("artist_balance_entries")
      .update({ entry_type: AUTO_SYNC_ENTRY_TYPE, amount: params.amount, entry_date: entryDate, description, updated_at: new Date().toISOString() })
      .eq("id", decision.entryId);
    if (updateErr) {
      console.error(`[artist-balance-show-sync] update failed for entry ${decision.entryId} (tx ${params.transactionId}):`, updateErr.message);
    }
  } catch (e) {
    console.error("[artist-balance-show-sync] syncArtistBalanceFromShow crashed:", e);
  }
}

/**
 * Remove the synced ledger entry for a transaction whose artist fee is no
 * longer standing — the transaction was cancelled (payment_status → "בוטל"
 * via a normal syncShowFinance patch), or the transaction itself is about to
 * be / was just deleted (clearShowFinance / deleteShowFinance). Deletes ONLY
 * the exact row matched by source_tx_id = transactionId — never by
 * description, amount, or any other heuristic. A "הכנסות" entry (fee already
 * actually received) is NEVER deleted here — it stays as paid-income history.
 */
export async function removeSyncedArtistBalanceEntry(transactionId: string | null | undefined): Promise<void> {
  if (!transactionId) return;
  try {
    const { data: existing, error: readErr } = await supabase
      .from("artist_balance_entries")
      .select("id, entry_type")
      .eq("source_tx_id", transactionId)
      .maybeSingle();
    if (readErr) {
      console.error(`[artist-balance-show-sync] removal read failed for tx ${transactionId}:`, readErr.message);
      return;
    }

    const decision = decideRemovalAction(existing);
    if (decision.action === "none") return; // nothing synced for this transaction
    if (decision.action === "keep_received") {
      console.log(`[artist-balance-show-sync] keep: tx ${transactionId} entry already הכנסות — not deleted on cancel/delete`);
      return;
    }

    const { error: delErr } = await supabase.from("artist_balance_entries").delete().eq("id", decision.entryId).eq("source_tx_id", transactionId);
    if (delErr) {
      console.error(`[artist-balance-show-sync] removal delete failed for entry ${decision.entryId} (tx ${transactionId}):`, delErr.message);
    }
  } catch (e) {
    console.error("[artist-balance-show-sync] removeSyncedArtistBalanceEntry crashed:", e);
  }
}
