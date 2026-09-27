/**
 * Pure decision logic for lib/artist-balance-show-sync.ts — no "server-only"/
 * Supabase imports, so it's testable from a plain script (mirrors
 * lib/shalev-weekly-pure.ts's decideClaimAction split). All DB I/O and the
 * INSERT-first/23505-recovery mechanics stay in the impure wrapper; only the
 * "what should happen" decisions live here.
 */

export type BalanceEntryType = "הכנסות" | "הכנסות צפויות" | "תשלומים" | "הוצאות" | "הוצאות צפויות";

/**
 * Unambiguous single-artist-token extraction — the exact same `,`/`،`/`;`
 * delimiter convention already used everywhere else in this codebase for
 * collab detection (e.g. lib/red-artists/weekly-events.ts's isThisArtist).
 * Returns null for an empty field or a multi-artist (collab) show — both are
 * ambiguous and must never be partially/fuzzily attributed.
 */
export function singleArtistToken(showArtist: string | null | undefined): string | null {
  const tokens = (showArtist ?? "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
  return tokens.length === 1 ? tokens[0] : null;
}

/**
 * B4 identity of a show's artist for the show → ledger sync. Shows carry NO label_artists id (shows.artist_client_id
 * is a CLIENTS id, not a label identity), so the only link is the exact name — reported honestly: a single credit is
 * NAME_TEXT_MATCH, a collaboration is COLLAB_AMBIGUOUS (never attributed), an empty field is EMPTY.
 */
export type ShowArtistIdentity =
  | { status: "SINGLE"; token: string; quality: "TEXT_MATCH"; basis: string }
  | { status: "COLLAB_AMBIGUOUS"; tokens: string[]; quality: "AMBIGUOUS"; basis: string }
  | { status: "EMPTY"; quality: "UNKNOWN"; basis: string };
export function showArtistIdentity(showArtist: string | null | undefined): ShowArtistIdentity {
  const tokens = (showArtist ?? "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return { status: "EMPTY", quality: "UNKNOWN", basis: "no artist on the show" };
  if (tokens.length > 1) return { status: "COLLAB_AMBIGUOUS", tokens, quality: "AMBIGUOUS", basis: "collaboration show — no single artist to attribute the fee to (shows store no label-artist id)" };
  return { status: "SINGLE", token: tokens[0], quality: "TEXT_MATCH", basis: "exact show artist name → label_artists.name (shows store no label-artist id)" };
}

/**
 * The automatic sync NEVER creates or promotes a "הכנסות" (realized) row —
 * that transition is manual-only, via the balance page's "סמן כהתקבל" action.
 * Regardless of the show/transaction's payment_status (שולם or צפוי), the
 * automatic sync always targets "הכנסות צפויות". A row that's already
 * "הכנסות" is handled separately by decideSyncAction (frozen, never touched).
 */
export const AUTO_SYNC_ENTRY_TYPE: "הכנסות צפויות" = "הכנסות צפויות";

export type ExistingEntry = { id: string; entry_type: string };

export type SyncDecision =
  | { action: "insert" }
  | { action: "update"; entryId: string }
  | { action: "skip_already_received" };

/**
 * What to do once we know whether a ledger row already exists for this
 * transaction (either found by the initial lookup, or found via the
 * post-23505-conflict recovery read). A "הכנסות" row is FROZEN — once the
 * artist was actually paid, a later show edit never touches that row again.
 */
export function decideSyncAction(existing: ExistingEntry | null): SyncDecision {
  if (!existing) return { action: "insert" };
  if (existing.entry_type === "הכנסות") return { action: "skip_already_received" };
  return { action: "update", entryId: existing.id };
}

export type RemovalDecision =
  | { action: "none" }
  | { action: "keep_received" }
  | { action: "delete"; entryId: string };

/**
 * What to do when a show/transaction is cancelled or deleted. Nothing synced
 * for this transaction → no-op. Already "הכנסות" (money actually received) →
 * kept as paid-income history, never auto-deleted. Still "הכנסות צפויות" (a
 * promise that will now never materialize) → delete that exact row.
 */
export function decideRemovalAction(existing: ExistingEntry | null): RemovalDecision {
  if (!existing) return { action: "none" };
  if (existing.entry_type === "הכנסות") return { action: "keep_received" };
  return { action: "delete", entryId: existing.id };
}
