import "server-only";
import { supabase } from "./supabase";

/**
 * "Free beats" (ביטים פנויים) — OWNER-only pool of instrumentals available to work
 * on. Global (NOT per-artist): the bytes live under a single Dropbox folder
 * (/nagashbeatz/beats) and the rows live in public.beats. Completely standalone —
 * no FK to projects/artists, never surfaced to the shalev portal (owner-only API).
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

/** All available beats, newest first. */
export async function listBeats(): Promise<Beat[]> {
  const { data, error } = await supabase
    .from("beats")
    .select("*")
    .eq("status", "available")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbRow[]).map(mapRow);
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

/** Delete a beat row by id. Returns true when a row was removed. */
export async function deleteBeat(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("beats").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return !!data && data.length > 0;
}
