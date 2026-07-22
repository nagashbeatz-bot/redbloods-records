import "server-only";
import { supabase } from "./supabase";

/**
 * Artist balance ledger — a MANUAL, owner-only ledger per label artist
 * (public.artist_balance_entries). This table is INDEPENDENT: after a one-time
 * backfill it is never synced with transactions / Shows / Finance again. The
 * canonical totals live here in one shared helper so the API and any server
 * caller compute the balance identically (never re-derived on the client).
 *
 * Scope is ALWAYS by artist_id (label_artists.id) — never by artist name.
 */

export const BALANCE_ENTRY_TYPES = ["שולם לי", "צפוי לי", "הוצאה ששולמה", "הוצאה צפויה"] as const;
export type BalanceEntryType = (typeof BALANCE_ENTRY_TYPES)[number];

export function isBalanceEntryType(v: unknown): v is BalanceEntryType {
  return typeof v === "string" && (BALANCE_ENTRY_TYPES as readonly string[]).includes(v);
}

/**
 * Strict YYYY-MM-DD validity — rejects malformed strings AND impossible dates
 * (e.g. 2026-02-30) by requiring the parsed date to round-trip back to the input.
 */
export function isValidYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A single ledger row (app-shaped; DB is snake_case). */
export interface ArtistBalanceEntry {
  id: string;
  artistId: string;
  entryType: BalanceEntryType;
  amount: number;
  entryDate: string;          // YYYY-MM-DD
  description: string;
  note: string;
  sourceTxId: string | null;  // backfill provenance only — never used for sync
  createdAt: string;
  updatedAt: string;
}

/** Canonical aggregated totals. currentBalance = paid − expPaid (expected NOT counted). */
export interface ArtistBalanceTotals {
  paid: number;            // Σ "שולם לי"
  expected: number;        // Σ "צפוי לי"
  expPaid: number;         // Σ "הוצאה ששולמה"
  expExpected: number;     // Σ "הוצאה צפויה"
  currentBalance: number;  // paid − expPaid
}

interface DbRow {
  id: string;
  artist_id: string;
  entry_type: string;
  amount: number | string;
  entry_date: string;
  description: string | null;
  note: string | null;
  source_tx_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(db: DbRow): ArtistBalanceEntry {
  return {
    id: db.id,
    artistId: db.artist_id,
    entryType: db.entry_type as BalanceEntryType,
    amount: Number(db.amount) || 0,
    entryDate: db.entry_date,
    description: db.description ?? "",
    note: db.note ?? "",
    sourceTxId: db.source_tx_id ?? null,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

/** All entries for one artist, sorted entry_date desc → created_at desc. */
export async function listArtistBalanceEntries(artistId: string): Promise<ArtistBalanceEntry[]> {
  const { data, error } = await supabase
    .from("artist_balance_entries")
    .select("*")
    .eq("artist_id", artistId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbRow[]).map(mapRow);
}

/** The ONE canonical totals computation — shared by every caller. */
export function computeArtistBalanceTotals(entries: ArtistBalanceEntry[]): ArtistBalanceTotals {
  const sum = (type: BalanceEntryType) =>
    entries.filter((e) => e.entryType === type).reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const paid = sum("שולם לי");
  const expected = sum("צפוי לי");
  const expPaid = sum("הוצאה ששולמה");
  const expExpected = sum("הוצאה צפויה");
  return { paid, expected, expPaid, expExpected, currentBalance: paid - expPaid };
}

/** Create a ledger entry. artistId comes from the URL (verified owner-side), NEVER from the client body. */
export async function createArtistBalanceEntry(fields: {
  artistId: string;
  entryType: BalanceEntryType;
  amount: number;
  entryDate: string;
  description: string;
  note: string;
}): Promise<ArtistBalanceEntry> {
  const { data, error } = await supabase
    .from("artist_balance_entries")
    .insert({
      artist_id: fields.artistId,
      entry_type: fields.entryType,
      amount: fields.amount,
      entry_date: fields.entryDate,
      description: fields.description ?? "",
      note: fields.note ?? "",
      // source_tx_id intentionally omitted — only the backfill sets it
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as DbRow);
}

/**
 * Update a ledger entry. Scoped by BOTH id AND artist_id so an entry can only be
 * edited through its own artist's endpoint (defense against cross-artist IDOR).
 * updated_at is set explicitly here (fix#6 — no DB trigger). Returns null when no
 * row matched (wrong id or wrong artist).
 */
export async function updateArtistBalanceEntry(
  id: string,
  artistId: string,
  patch: { entryType: BalanceEntryType; amount: number; entryDate: string; description: string; note: string },
): Promise<ArtistBalanceEntry | null> {
  const { data, error } = await supabase
    .from("artist_balance_entries")
    .update({
      entry_type: patch.entryType,
      amount: patch.amount,
      entry_date: patch.entryDate,
      description: patch.description ?? "",
      note: patch.note ?? "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("artist_id", artistId)
    .select("*");
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? mapRow(data[0] as DbRow) : null;
}

/** Delete a ledger entry, scoped by id AND artist_id. Returns false when nothing matched. */
export async function deleteArtistBalanceEntry(id: string, artistId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("artist_balance_entries")
    .delete()
    .eq("id", id)
    .eq("artist_id", artistId)
    .select("id");
  if (error) throw new Error(error.message);
  return !!data && data.length > 0;
}
