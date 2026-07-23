import "server-only";
import { randomUUID } from "crypto";
import { dropboxArg } from "@/lib/mix-version-upload";
import { sanitizeFolder } from "@/lib/project-paths";
import { createBeat, isBeatGenre, type Beat, type BeatGenre } from "@/lib/beats-store";

/**
 * "Free beats" upload core — server-only. OWNER-only (the caller authorizes).
 *
 * - Global folder: /nagashbeatz/beats (NEVER a red-artists / shalev / artist path).
 * - Unique on-disk name PER upload: `{base}__{yyyymmdd-hhmmss}-{rand}.{ext}`, so
 *   uploading two beats with the SAME display name never overwrites or clashes.
 *   Upload is mode:add + autorename:false (no silent Dropbox rename); the token
 *   makes a real collision effectively impossible, and we still persist the ACTUAL
 *   path/name Dropbox returns.
 * - Orphan-safe: bytes go to Dropbox first, then the beats row; if the insert
 *   fails we delete ONLY the file we just created (never a pre-existing file, no
 *   broad cleanup).
 * - Single-shot (≤150MB, Dropbox's single-request limit). Larger files are
 *   rejected with a clear message rather than silently truncated.
 */

const BEATS_FOLDER = "/nagashbeatz/beats";
const MAX_BYTES = 150 * 1024 * 1024; // Dropbox single-request upload limit
const AUDIO_EXT = /\.(mp3|wav|aiff?|m4a|flac|ogg)$/i;

export type BeatUploadResult =
  | { ok: true; beat: Beat }
  | { ok: false; status: number; error: string };

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** Safe base for the Dropbox file name — keeps Hebrew, strips path-illegal chars. */
function safeBase(displayName: string, fallbackFileName: string): string {
  const src = (displayName || "").trim() || fallbackFileName.replace(/\.[^.]+$/, "");
  const cleaned = sanitizeFolder(src).replace(/\.+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "beat";
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

async function dropboxDelete(token: string, path: string): Promise<void> {
  try {
    await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch { /* best-effort */ }
}

/** Upload one beat file (single-shot). Caller must have authorized (owner-only). */
export async function uploadBeatSingle(input: {
  file: File | null;
  name: string;
  genre: string;
}): Promise<BeatUploadResult> {
  const { file } = input;
  if (!file) return { ok: false, status: 400, error: "חסר קובץ" };

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, status: 400, error: "יש להזין שם לביט" };

  if (!isBeatGenre(input.genre)) return { ok: false, status: 400, error: "יש לבחור ז׳אנר" };
  const genre: BeatGenre = input.genre;

  if (!AUDIO_EXT.test(file.name)) {
    return { ok: false, status: 400, error: "סוג קובץ לא נתמך (MP3/WAV/AIFF/M4A/FLAC/OGG)" };
  }
  if (file.size <= 0) return { ok: false, status: 400, error: "הקובץ ריק" };
  if (file.size > MAX_BYTES) {
    return { ok: false, status: 413, error: "הקובץ גדול מדי (מקסימום 150MB)" };
  }

  const ext = extOf(file.name);
  const fileName = uniqueFileName(safeBase(name, file.name), ext);
  const dropboxPath = `${BEATS_FOLDER}/${fileName}`;

  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const buffer = Buffer.from(await file.arrayBuffer());

  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      // add + autorename:false → never overwrites; the injected token guarantees uniqueness.
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

  // Persist the row using the ACTUAL returned path/name; compensate on failure.
  try {
    const res = await createBeat({
      name,
      genre,
      fileName: uploaded.name ?? fileName,
      dropboxPath: uploaded.path_display ?? dropboxPath,
      durationSeconds: null,
    });
    if (res.status === "duplicate") {
      await dropboxDelete(token, uploaded.path_display ?? dropboxPath); // remove the orphan we just made
      return { ok: false, status: 409, error: "כבר קיים ביט זהה" };
    }
    return { ok: true, beat: res.beat };
  } catch (dbErr) {
    await dropboxDelete(token, uploaded.path_display ?? dropboxPath); // remove the orphan we just made
    throw dbErr;
  }
}
