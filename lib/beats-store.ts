import "server-only";
import { supabase } from "./supabase";

/**
 * "Free beats" (ביטים פנויים) — the canonical Redbloods beat repository. The bytes
 * live under a single Dropbox folder (/nagashbeatz/beats) and the rows live in
 * public.beats: one file, one row, never duplicated per artist.
 *
 * WHICH ARTIST SEES A BEAT is a separate fact in beat_artist_assignments
 * (beat_id → artist_slug, slugs from lib/red-artists/portal-registry.ts). The
 * owner's central page reads the repository unfiltered; an artist portal reads
 * only what is assigned to that artist. Removing an assignment hides the beat
 * from that artist and leaves the row and the Dropbox file untouched.
 *
 * The DISPLAY name is `name`; `file_name`/`dropbox_path` hold the real, unique
 * on-disk identity (a token is injected per upload so two beats can share a
 * display name without ever overwriting each other). Uniqueness is enforced by
 * the DB (unique index on lower(dropbox_path)).
 */

/** Canonical genre keys stored in the DB (display labels are a client concern). */
export const BEAT_GENRES = ["dancehall", "rnb", "hiphop", "soul"] as const;
export type BeatGenre = (typeof BEAT_GENRES)[number];
const GENRE_SET = new Set<string>(BEAT_GENRES);
export function isBeatGenre(g: string): g is BeatGenre {
  return GENRE_SET.has(g);
}

/** Musical key — stored canonically as "<note> <type>" (e.g. "G Minor"), matching
 * the beats_musical_key_check DB constraint (24 combinations). Nullable in the DB
 * (legacy beats have none → "לא הוגדר" in the UI); required by the create/update flow. */
export const BEAT_KEY_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const BEAT_KEY_TYPES = ["Major", "Minor"] as const;
const MUSICAL_KEY_SET = new Set<string>(
  BEAT_KEY_NOTES.flatMap((n) => BEAT_KEY_TYPES.map((t) => `${n} ${t}`)),
);
export function isMusicalKey(k: string): boolean {
  return MUSICAL_KEY_SET.has(k);
}

/**
 * Normalized form for duplicate-name detection: case-insensitive, whitespace- and
 * separator-insensitive. "Midnight Ride", "midnight  ride", "midnight-ride" and
 * "midnight_ride" all normalize to the same value. Never mutates the stored name.
 */
export function normalizeBeatName(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Beat {
  id: string;
  name: string;            // display name (owner-typed)
  genre: BeatGenre;
  musicalKey: string | null; // "<note> <type>" e.g. "G Minor", or null (legacy)
  fileName: string;        // real unique file name on Dropbox
  dropboxPath: string;     // real path returned by Dropbox
  durationSeconds: number | null;
  status: "available" | "archived";
  createdAt: string;
}

interface DbRow {
  id: string;
  name: string;
  genre: string;
  musical_key: string | null;
  file_name: string;
  dropbox_path: string;
  duration_seconds: number | string | null;
  status: string;
  created_at: string;
}

function mapRow(db: DbRow): Beat {
  return {
    id: db.id,
    name: db.name,
    genre: (isBeatGenre(db.genre) ? db.genre : "soul") as BeatGenre,
    musicalKey: db.musical_key ?? null,
    fileName: db.file_name,
    dropboxPath: db.dropbox_path,
    durationSeconds: db.duration_seconds != null ? Number(db.duration_seconds) : null,
    status: db.status === "archived" ? "archived" : "available",
    createdAt: db.created_at,
  };
}

/** Postgres unique_violation — surfaced by the case-insensitive dropbox_path index. */
export const UNIQUE_VIOLATION = "23505";

/**
 * Available beats, newest first.
 *
 * `beats` stays the canonical repository — ONE row and ONE Dropbox file per beat,
 * whoever it is shown to. Which artist SEES a beat is a separate fact, stored in
 * beat_artist_assignments; passing an artistSlug filters to that artist's assigned
 * beats via an inner join, and passing nothing returns the central repository.
 * A beat is never copied and its dropbox_path never differs per artist.
 */
export async function listBeats(artistSlug?: string): Promise<Beat[]> {
  const q = artistSlug
    // !inner → rows with no assignment for this slug are dropped entirely.
    ? supabase
        .from("beats")
        .select("*, beat_artist_assignments!inner(artist_slug)")
        .eq("beat_artist_assignments.artist_slug", artistSlug)
    : supabase.from("beats").select("*");

  const { data, error } = await q
    .eq("status", "available")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbRow[]).map(mapRow);
}

/** The artist slugs a beat is currently assigned to. */
export async function listBeatAssignments(beatId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("beat_artist_assignments")
    .select("artist_slug")
    .eq("beat_id", beatId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { artist_slug: string }).artist_slug);
}

/**
 * Show a beat to an artist. Idempotent: the UNIQUE (beat_id, artist_slug) index
 * means a double click can never create a second row. Copies nothing — the beat
 * row and its Dropbox file are untouched.
 */
export async function assignBeatToArtist(beatId: string, artistSlug: string): Promise<void> {
  const { error } = await supabase
    .from("beat_artist_assignments")
    .upsert({ beat_id: beatId, artist_slug: artistSlug }, { onConflict: "beat_id,artist_slug", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/**
 * Stop showing a beat to an artist. Deletes ONLY the assignment row — the beat
 * stays in the repository and the Dropbox file is never touched.
 */
export async function unassignBeatFromArtist(beatId: string, artistSlug: string): Promise<void> {
  const { error } = await supabase
    .from("beat_artist_assignments")
    .delete()
    .eq("beat_id", beatId)
    .eq("artist_slug", artistSlug);
  if (error) throw new Error(error.message);
}

/** Is this beat assigned to this artist? Gates per-beat access (stream/download)
 *  so an artist can never reach a beat that was never assigned to them. */
export async function isBeatAssignedTo(beatId: string, artistSlug: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("beat_artist_assignments")
    .select("id")
    .eq("beat_id", beatId)
    .eq("artist_slug", artistSlug)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** All beat id+name pairs (for the server-side duplicate-name check). Cheap. */
export async function listBeatNames(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from("beats").select("id, name");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

/** Look up one beat (for the stream endpoint). */
export async function getBeat(id: string): Promise<Beat | null> {
  const { data, error } = await supabase.from("beats").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as DbRow) : null;
}

export type CreateBeatResult =
  | { status: "ok"; beat: Beat }
  | { status: "duplicate" };

/** Insert a beat row. Returns "duplicate" on the unique dropbox_path violation. */
export async function createBeat(row: {
  name: string;
  genre: BeatGenre;
  musicalKey: string | null;
  fileName: string;
  dropboxPath: string;
  durationSeconds: number | null;
}): Promise<CreateBeatResult> {
  const { data, error } = await supabase
    .from("beats")
    .insert({
      name:             row.name,
      genre:            row.genre,
      musical_key:      row.musicalKey,
      file_name:        row.fileName,
      dropbox_path:     row.dropboxPath,
      duration_seconds: row.durationSeconds,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "ok", beat: mapRow(data as DbRow) };
}

export type UpdateBeatResult =
  | { status: "ok"; beat: Beat }
  | { status: "duplicate" }
  | { status: "not_found" };

/**
 * Update a beat row IN PLACE (same id) after a NEW file has been uploaded. Only the
 * mutable fields change; the id/created_at are preserved. "duplicate" on the unique
 * dropbox_path violation, "not_found" when the id no longer exists.
 */
export async function updateBeatRow(id: string, fields: {
  name: string;
  genre: BeatGenre;
  musicalKey: string | null;
  fileName: string;
  dropboxPath: string;
  durationSeconds: number | null;
}): Promise<UpdateBeatResult> {
  const { data, error } = await supabase
    .from("beats")
    .update({
      name:             fields.name,
      genre:            fields.genre,
      musical_key:      fields.musicalKey,
      file_name:        fields.fileName,
      dropbox_path:     fields.dropboxPath,
      duration_seconds: fields.durationSeconds,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    throw new Error(error.message);
  }
  if (!data) return { status: "not_found" };
  return { status: "ok", beat: mapRow(data as DbRow) };
}

/**
 * Metadata-only update — changes ONLY name/genre/musical_key. file_name,
 * dropbox_path and duration_seconds are left exactly as they are (the existing
 * Dropbox file is untouched). Used when the owner edits a beat without replacing
 * its audio.
 */
export async function updateBeatMeta(id: string, fields: {
  name: string;
  genre: BeatGenre;
  musicalKey: string | null;
}): Promise<UpdateBeatResult> {
  const { data, error } = await supabase
    .from("beats")
    .update({
      name:        fields.name,
      genre:       fields.genre,
      musical_key: fields.musicalKey,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    throw new Error(error.message);
  }
  if (!data) return { status: "not_found" };
  return { status: "ok", beat: mapRow(data as DbRow) };
}

/** Delete a beat row by id. Returns true when a row was removed. */
export async function deleteBeat(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("beats").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return !!data && data.length > 0;
}
