import "server-only";
import { randomUUID } from "crypto";
import { dropboxArg } from "@/lib/mix-version-upload";
import { sanitizeFolder } from "@/lib/project-paths";
import {
  createBeat, updateBeatRow, updateBeatMeta, deleteBeat, getBeat, listBeatNames, normalizeBeatName,
  isBeatGenre, isMusicalKey, type Beat, type BeatGenre,
} from "@/lib/beats-store";

/**
 * "Free beats" upload/update/delete core — server-only. OWNER-only (the caller
 * authorizes via requireOwner).
 *
 * - Global folder: /nagashbeatz/beats (NEVER a red-artists / shalev / artist path).
 * - Unique on-disk name PER upload: `{base}__{yyyymmdd-hhmmss}-{rand}.{ext}`, so a
 *   new upload (create OR update) never overwrites/clashes with any existing file.
 *   Upload is mode:add + autorename:false; we persist the ACTUAL returned path/name.
 * - Orphan-safe: bytes go to Dropbox first, then the DB write. If the DB write
 *   fails we delete ONLY the file we just created in THIS request — never a
 *   pre-existing/old file, never a broad folder cleanup.
 * - UPDATE keeps the same beat id and does NOT touch/delete the old file (it stays
 *   in Dropbox, by design). DELETE removes ONLY the beat's currently-stored
 *   dropbox_path (guarded to be under /nagashbeatz/beats/), then the row.
 * - Single-shot (≤150MB, Dropbox's single-request limit).
 */

export const BEATS_FOLDER = "/nagashbeatz/beats";
const MAX_BYTES = 150 * 1024 * 1024; // Dropbox single-request upload limit
const AUDIO_EXT = /\.(mp3|wav|aiff?|m4a|flac|ogg)$/i;
const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks arbitrary ids / traversal

export type BeatUploadResult =
  | { ok: true; beat: Beat }
  | { ok: false; status: number; error: string };

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Safe Dropbox base name built from the OWNER-typed BEAT NAME (never the original
 * upload filename) — keeps Hebrew/English, strips path-illegal chars + stray dots,
 * trims, never empty. The uniqueness token is added separately in uniqueFileName.
 */
function safeBase(beatName: string): string {
  const cleaned = sanitizeFolder((beatName || "").trim()).replace(/\.+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "beat";
}

/** Server-side duplicate-name guard. Returns the clashing beat's stored name, or
 *  null when the name is free. `excludeId` skips the beat being updated (itself). */
async function findNameClash(beatName: string, excludeId?: string): Promise<string | null> {
  const norm = normalizeBeatName(beatName);
  const rows = await listBeatNames();
  const hit = rows.find((r) => r.id !== excludeId && normalizeBeatName(r.name) === norm);
  return hit ? hit.name : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A per-upload-unique file name: `{base}__{yyyymmdd-hhmmss}-{rand}.{ext}`. */
function uniqueFileName(base: string, ext: string): string {
  const d = new Date();
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const rand = randomUUID().slice(0, 6);
  const stem = `${base}__${stamp}-${rand}`;
  return ext ? `${stem}.${ext}` : stem;
}

async function getToken(): Promise<string> {
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  return getDropboxToken();
}

async function dropboxDelete(token: string, path: string): Promise<void> {
  try {
    await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch { /* best-effort */ }
}

/** Delete that distinguishes "already gone" (ok to proceed) from a real failure. */
async function dropboxDeleteChecked(
  token: string, path: string,
): Promise<{ ok: true } | { ok: false; notFound: boolean }> {
  const res = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (res.ok) return { ok: true };
  const t = await res.text().catch(() => "");
  return { ok: false, notFound: /not_found/.test(t) };
}

type Meta = { name: string; genre: BeatGenre; musicalKey: string };
type MetaResult = { ok: true; meta: Meta } | { ok: false; status: number; error: string };
type FileResult = { ok: true; buffer: Buffer; ext: string } | { ok: false; status: number; error: string };

/** Validate the ALWAYS-required metadata (name + genre + key). No file here. */
function validateMeta(rawName: string, rawGenre: string, rawKey: string): MetaResult {
  const name = (rawName ?? "").trim();
  if (!name) return { ok: false, status: 400, error: "יש להזין שם לביט" };
  if (!isBeatGenre(rawGenre)) return { ok: false, status: 400, error: "יש לבחור ז׳אנר" };
  const key = (rawKey ?? "").trim();
  if (!isMusicalKey(key)) return { ok: false, status: 400, error: "יש לבחור סולם (תו + Major/Minor)" };
  return { ok: true, meta: { name, genre: rawGenre, musicalKey: key } };
}

/** Validate an audio file (only when one is actually provided) and read its bytes. */
async function validateFile(file: File): Promise<FileResult> {
  if (!AUDIO_EXT.test(file.name)) {
    return { ok: false, status: 400, error: "סוג קובץ לא נתמך (MP3/WAV/AIFF/M4A/FLAC/OGG)" };
  }
  if (file.size <= 0) return { ok: false, status: 400, error: "הקובץ ריק" };
  if (file.size > MAX_BYTES) return { ok: false, status: 413, error: "הקובץ גדול מדי (מקסימום 150MB)" };
  const buffer = Buffer.from(await file.arrayBuffer());
  return { ok: true, buffer, ext: extOf(file.name) };
}

/** Upload bytes to a fresh unique path; returns the ACTUAL Dropbox path/name. */
async function uploadNewFile(beatName: string, buffer: Buffer, ext: string, token: string):
  Promise<{ ok: true; path: string; name: string } | { ok: false; status: number; error: string }> {
  const fileName = uniqueFileName(safeBase(beatName), ext);
  const dropboxPath = `${BEATS_FOLDER}/${fileName}`;
  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": dropboxArg({ path: dropboxPath, mode: "add", autorename: false, mute: true }),
    },
    body: buffer as unknown as BodyInit,
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    let detail = t; try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
    return { ok: false, status: 500, error: `Dropbox: ${detail}` };
  }
  const uploaded = (await uploadRes.json()) as { path_display: string; name: string };
  return { ok: true, path: uploaded.path_display ?? dropboxPath, name: uploaded.name ?? fileName };
}

/** Create one beat (single-shot). A file is REQUIRED here. Caller authorizes (owner). */
export async function uploadBeatSingle(input: {
  file: File | null; name: string; genre: string; musicalKey: string;
}): Promise<BeatUploadResult> {
  const metaR = validateMeta(input.name, input.genre, input.musicalKey);
  if (!metaR.ok) return metaR;
  const { meta } = metaR;
  if (!input.file) return { ok: false, status: 400, error: "חסר קובץ" };
  const fileR = await validateFile(input.file);
  if (!fileR.ok) return fileR;

  // Duplicate-name guard — BEFORE any Dropbox upload (never write bytes on a clash).
  const clash = await findNameClash(meta.name);
  if (clash) return { ok: false, status: 409, error: `כבר קיים ביט בשם דומה: ${clash}. בחר שם אחר.` };

  const token = await getToken();
  const up = await uploadNewFile(meta.name, fileR.buffer, fileR.ext, token);
  if (!up.ok) return up;

  try {
    const res = await createBeat({ name: meta.name, genre: meta.genre, musicalKey: meta.musicalKey, fileName: up.name, dropboxPath: up.path, durationSeconds: null });
    if (res.status === "duplicate") {
      await dropboxDelete(token, up.path); // remove the orphan we just made
      return { ok: false, status: 409, error: "כבר קיים ביט זהה" };
    }
    return { ok: true, beat: res.beat };
  } catch (dbErr) {
    await dropboxDelete(token, up.path); // remove the orphan we just made
    throw dbErr;
  }
}

/**
 * Update a beat. The audio file is OPTIONAL:
 *  - NO file  → metadata-only update (name/genre/musical_key). file_name,
 *    dropbox_path and the existing Dropbox file are left untouched; Dropbox is
 *    never called.
 *  - WITH file → upload a NEW file to a fresh unique path, point the SAME row at it
 *    (file_name/dropbox_path change). The OLD file is intentionally LEFT in Dropbox;
 *    on a DB failure only the just-uploaded new file is deleted.
 * The beat id is preserved in both cases.
 */
export async function updateBeatFile(input: {
  beatId: string; file: File | null; name: string; genre: string; musicalKey: string;
}): Promise<BeatUploadResult> {
  if (!ID_RE.test(input.beatId)) return { ok: false, status: 400, error: "מזהה לא תקין" };
  const existing = await getBeat(input.beatId);
  if (!existing) return { ok: false, status: 404, error: "הביט לא נמצא" };

  const metaR = validateMeta(input.name, input.genre, input.musicalKey);
  if (!metaR.ok) return metaR;
  const { meta } = metaR;

  // Duplicate-name guard — excludes THIS beat so an unchanged/same name never blocks
  // its own update; a name that belongs to ANOTHER beat is rejected.
  const clash = await findNameClash(meta.name, input.beatId);
  if (clash) return { ok: false, status: 409, error: `כבר קיים ביט בשם דומה: ${clash}. בחר שם אחר.` };

  // ── metadata-only (no new file): NEVER touches Dropbox ──────────────────────
  if (!input.file) {
    const res = await updateBeatMeta(input.beatId, { name: meta.name, genre: meta.genre, musicalKey: meta.musicalKey });
    if (res.status === "duplicate") return { ok: false, status: 409, error: "כבר קיים ביט זהה" };
    if (res.status === "not_found") return { ok: false, status: 404, error: "הביט לא נמצא" };
    return { ok: true, beat: res.beat };
  }

  // ── with a new file: replace the audio, keep the id, keep the old file ───────
  const fileR = await validateFile(input.file);
  if (!fileR.ok) return fileR;

  const token = await getToken();
  const up = await uploadNewFile(meta.name, fileR.buffer, fileR.ext, token); // upload NEW (old stays put)
  if (!up.ok) return up;

  try {
    const res = await updateBeatRow(input.beatId, {
      name: meta.name, genre: meta.genre, musicalKey: meta.musicalKey, fileName: up.name, dropboxPath: up.path, durationSeconds: null,
    });
    if (res.status === "duplicate") {
      await dropboxDelete(token, up.path);    // delete ONLY the new file; never the old one
      return { ok: false, status: 409, error: "כבר קיים ביט זהה" };
    }
    if (res.status === "not_found") {
      await dropboxDelete(token, up.path);    // row vanished mid-request → drop the new orphan
      return { ok: false, status: 404, error: "הביט לא נמצא" };
    }
    return { ok: true, beat: res.beat };      // OLD file deliberately kept in Dropbox
  } catch (dbErr) {
    await dropboxDelete(token, up.path);      // delete ONLY the new file; never the old one
    throw dbErr;
  }
}

/**
 * Fully delete a beat: remove ONLY its currently-stored file (guarded to be under
 * /nagashbeatz/beats/), then the row. Old files left over from prior updates are
 * NOT touched. A file that is already gone is treated as deletable (proceed to the
 * row); any other Dropbox failure aborts BEFORE the row is removed.
 */
export async function deleteBeatFully(beatId: string):
  Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!ID_RE.test(beatId)) return { ok: false, status: 400, error: "מזהה לא תקין" };
  const beat = await getBeat(beatId);
  if (!beat) return { ok: false, status: 404, error: "הביט לא נמצא" };

  // Hard guard: only ever delete inside the beats folder — never by filename, never
  // another artist's/project's path, never a folder cleanup.
  if (!beat.dropboxPath.startsWith(`${BEATS_FOLDER}/`) || beat.dropboxPath.includes("..")) {
    return { ok: false, status: 400, error: "נתיב הקובץ אינו בתיקיית הביטים — לא בוצעה מחיקה" };
  }

  const token = await getToken();
  const del = await dropboxDeleteChecked(token, beat.dropboxPath);
  if (!del.ok && !del.notFound) {
    return { ok: false, status: 502, error: "מחיקת הקובץ מ-Dropbox נכשלה, נסה שוב" };
  }

  const removed = await deleteBeat(beatId); // file gone (now or already) → remove the row
  if (!removed) return { ok: false, status: 404, error: "הביט לא נמצא" };
  return { ok: true };
}
