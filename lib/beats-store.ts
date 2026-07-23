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

export interface Beat {
  id: string;
  name: string;            // display name (owner-typed)
  genre: BeatGenre;
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
  fileName: string;
  dropboxPath: string;
  durationSeconds: number | null;
}): Promise<CreateBeatResult> {
  const { data, error } = await supabase
    .from("beats")
    .insert({
      name:             row.name,
      genre:            row.genre,
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
