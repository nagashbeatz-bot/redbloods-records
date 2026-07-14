import "server-only";
import { randomUUID } from "crypto";
import { getDropboxToken } from "@/lib/dropbox-token";
import { sanitizeFolder } from "@/lib/project-paths";

/**
 * Standalone "המוזיקה שלי" store for the Shalev portal — a Dropbox-backed manifest
 * is the SINGLE SOURCE OF TRUTH (no Projects, no DB). All reads/writes are
 * server-side; the client never sends a path or manages version numbers.
 *
 *   files:    /app/red-artists/shalev-tasama/uploads/sketches/{id}/{title} V{n}.{ext}
 *   manifest: /app/red-artists/shalev-tasama/uploads/sketches/manifest.json
 *
 * Concurrency: manifest writes are conditional on the Dropbox file `rev`
 * (mode=update{rev}); a rev clash → read-modify-write retry. A brand-new manifest
 * is created with mode=add. Corrupt manifest is NEVER silently overwritten.
 */

const ROOT = "/app/red-artists/shalev-tasama/uploads/sketches";
const MANIFEST_PATH = `${ROOT}/manifest.json`;

export const SKETCH_AUDIO_EXT = ["mp3", "wav", "aiff", "aif", "m4a"] as const;
const AUDIO_EXT = new Set<string>(SKETCH_AUDIO_EXT);
export const SKETCH_MAX_BYTES = 500 * 1024 * 1024; // 500MB (matches the UI)

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SketchVersion {
  versionNumber: number;
  fileName: string;
  filePath: string;
  extension: string;
  uploadedAt: string;
  sizeBytes?: number;
  durationSeconds?: number;
}
export interface Sketch {
  id: string;
  title: string;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
  latestFilePath: string;
  latestFileName: string;
  durationSeconds?: number;
  versions: SketchVersion[];
  archived: boolean;
  archivedAt?: string | null;
}
/** The portal's "next release" pointer — a sketch id + a release date (YYYY-MM-DD).
 * Stored in the manifest (single source of truth); no Projects / project_release_details. */
export interface NextReleaseRef { sketchId: string; releaseDate: string; updatedAt: string }
/** A NextReleaseRef resolved against the current sketches (adds the live title). */
export interface ResolvedNextRelease { sketchId: string; title: string; releaseDate: string; updatedAt: string }

interface Manifest {
  schemaVersion: number;
  sketches: Sketch[];
  /** Explicit display order for ACTIVE sketches (stable ids). Absent on legacy
   * manifests → a deterministic order is derived (see `effectiveOrder`). */
  order?: string[];
  /** The chosen "next release" (points at one active sketch). Optional/absent. */
  nextRelease?: NextReleaseRef | null;
}

/** Typed error whose `code` the routes map to an HTTP status + a Hebrew message. */
export class SketchError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// ── Dropbox low-level ─────────────────────────────────────────────────────────
/** ASCII-only serialization for the Dropbox-API-Arg header (must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

type DbxMeta = { rev?: string; name?: string; path_display?: string; size?: number };

async function dbxDownload(path: string): Promise<{ content: string; rev: string } | null> {
  const token = await getDropboxToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": dropboxArg({ path }) },
  });
  if (res.status === 409) return null; // not found
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (t.includes("path/not_found")) return null;
    throw new SketchError("DROPBOX", `Dropbox download failed (${res.status})`);
  }
  const metaHeader = res.headers.get("dropbox-api-result");
  let rev = "";
  try { rev = (JSON.parse(metaHeader ?? "{}") as DbxMeta).rev ?? ""; } catch { /* ignore */ }
  const content = await res.text();
  return { content, rev };
}

type UploadMode = { ".tag": "add" } | { ".tag": "overwrite" } | { ".tag": "update"; update: string };

async function dbxUpload(path: string, body: Buffer, mode: UploadMode, autorename = false): Promise<DbxMeta> {
  const token = await getDropboxToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": dropboxArg({ path, mode, autorename, mute: true }),
    },
    // undici accepts a Buffer at runtime; the DOM BodyInit type widens Buffer's
    // generic too narrowly (TS 5.7), so cast — mirrors the existing upload route.
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // A conditional-update rev clash surfaces as a conflict — the caller retries.
    if (res.status === 409 && (t.includes("conflict") || t.includes("path"))) {
      throw new SketchError("CONFLICT", "conflict");
    }
    let detail = t;
    try { detail = (JSON.parse(t) as { error_summary?: string }).error_summary ?? t; } catch { /* keep */ }
    console.error("[sketches] dropbox upload failed:", detail);
    throw new SketchError("DROPBOX", "Dropbox upload failed");
  }
  return (await res.json()) as DbxMeta;
}

// ── Manifest helpers ──────────────────────────────────────────────────────────
function emptyManifest(): Manifest { return { schemaVersion: 1, sketches: [] }; }

/** Defensively fill missing fields on an older/partial manifest entry. */
function normalizeSketch(raw: Partial<Sketch> & { id?: string }): Sketch | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const versions: SketchVersion[] = Array.isArray(raw.versions)
    ? raw.versions.filter((v): v is SketchVersion => !!v && typeof v.versionNumber === "number" && typeof v.filePath === "string")
    : [];
  const latest = versions.length ? versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a)) : null;
  return {
    id: String(raw.id),
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    latestVersion: typeof raw.latestVersion === "number" ? raw.latestVersion : (latest?.versionNumber ?? 0),
    latestFilePath: typeof raw.latestFilePath === "string" ? raw.latestFilePath : (latest?.filePath ?? ""),
    latestFileName: typeof raw.latestFileName === "string" ? raw.latestFileName : (latest?.fileName ?? ""),
    durationSeconds: typeof raw.durationSeconds === "number" ? raw.durationSeconds : undefined,
    versions,
    archived: raw.archived === true,
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
  };
}

async function readManifest(): Promise<{ manifest: Manifest; rev: string | null }> {
  const dl = await dbxDownload(MANIFEST_PATH);
  if (!dl) return { manifest: emptyManifest(), rev: null };
  let parsed: unknown;
  try { parsed = JSON.parse(dl.content); }
  catch { throw new SketchError("MANIFEST_CORRUPT", "קובץ הנתונים של הספרייה פגום — לא בוצע שינוי כדי לא לאבד מידע"); }
  const rawList = (parsed as { sketches?: unknown })?.sketches;
  const sketches = Array.isArray(rawList)
    ? (rawList.map((r) => normalizeSketch(r as Sketch)).filter(Boolean) as Sketch[])
    : [];
  const rawOrder = (parsed as { order?: unknown })?.order;
  const order = Array.isArray(rawOrder)
    ? rawOrder.filter((x): x is string => typeof x === "string")
    : undefined;
  // Preserve the nextRelease pointer (defensively) so sketch mutations never wipe it.
  const rawNext = (parsed as { nextRelease?: unknown })?.nextRelease;
  let nextRelease: NextReleaseRef | null = null;
  if (rawNext && typeof rawNext === "object") {
    const n = rawNext as Partial<NextReleaseRef>;
    if (typeof n.sketchId === "string" && typeof n.releaseDate === "string") {
      nextRelease = { sketchId: n.sketchId, releaseDate: n.releaseDate, updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : new Date().toISOString() };
    }
  }
  return { manifest: { schemaVersion: 1, sketches, order, nextRelease }, rev: dl.rev };
}

/** Newest-updated first — the legacy/default ordering. */
function byUpdatedDesc(a: Sketch, b: Sketch): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

/**
 * The effective display order of ACTIVE sketches as a list of ids:
 * saved `order` first (filtered to still-active ids), then any active sketch
 * missing from it appended by updatedAt-desc. A legacy manifest with no `order`
 * therefore yields exactly the current default ordering — deterministic, lossless.
 */
function effectiveOrder(m: Manifest): string[] {
  const active = m.sketches.filter((s) => !s.archived);
  const activeIds = new Set(active.map((s) => s.id));
  const fromOrder = (m.order ?? []).filter((id) => activeIds.has(id));
  const seen = new Set(fromOrder);
  const rest = active.filter((s) => !seen.has(s.id)).sort(byUpdatedDesc).map((s) => s.id);
  return [...fromOrder, ...rest];
}

/** Read-modify-write with rev-conditional save; retries on a concurrent-write clash. */
async function mutateManifest(fn: (m: Manifest) => Manifest): Promise<Manifest> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { manifest, rev } = await readManifest();
    const next = fn(structuredClone(manifest));
    const body = Buffer.from(JSON.stringify(next, null, 2), "utf8");
    const mode: UploadMode = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
    try {
      await dbxUpload(MANIFEST_PATH, body, mode);
      return next;
    } catch (e) {
      if (e instanceof SketchError && e.code === "CONFLICT") continue; // someone else wrote — retry
      throw e;
    }
  }
  throw new SketchError("MANIFEST_BUSY", "הספרייה עסוקה כרגע, נסה שוב בעוד רגע");
}

// ── Filenames / titles ────────────────────────────────────────────────────────
function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}
/** Safe Dropbox base name — keeps Hebrew, strips path-illegal chars and stray dots. */
function safeBase(title: string): string {
  const cleaned = sanitizeFolder(title).replace(/\.+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "סקיצה";
}
function normTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── Input validation (shared by create + version) ─────────────────────────────
export interface UploadedAudio { name: string; ext: string; buffer: Buffer; size: number; mime: string }
/** Validates an incoming audio File → throws SketchError with a Hebrew message. */
export async function validateAudio(file: File | null): Promise<UploadedAudio> {
  if (!file) throw new SketchError("BAD_INPUT", "חסר קובץ אודיו");
  const ext = extOf(file.name);
  if (!AUDIO_EXT.has(ext)) throw new SketchError("BAD_TYPE", "ניתן להעלות קובצי אודיו בלבד (MP3, WAV, AIFF, M4A)");
  const mime = file.type || "";
  if (mime && !mime.startsWith("audio/") && mime !== "application/octet-stream") {
    throw new SketchError("BAD_TYPE", "הקובץ שנבחר אינו קובץ אודיו תקין");
  }
  if (file.size <= 0) throw new SketchError("BAD_INPUT", "הקובץ ריק");
  if (file.size > SKETCH_MAX_BYTES) throw new SketchError("TOO_BIG", "הקובץ גדול מדי (מקסימום 500MB)");
  const buffer = Buffer.from(await file.arrayBuffer());
  return { name: file.name, ext, buffer, size: file.size, mime };
}

// ── Public API ────────────────────────────────────────────────────────────────
/** Active (non-archived) sketches in the manifest's effective display order. */
export async function listSketches(): Promise<Sketch[]> {
  const { manifest } = await readManifest();
  const pos = new Map(effectiveOrder(manifest).map((id, i) => [id, i]));
  return manifest.sketches
    .filter((s) => !s.archived)
    .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

async function uploadVersionFile(id: string, title: string, version: number, audio: UploadedAudio): Promise<SketchVersion> {
  const fileName = `${safeBase(title)} V${version}.${audio.ext}`;
  const path = `${ROOT}/${id}/${fileName}`;
  // add + autorename → NEVER overwrites an existing file; we store the ACTUAL
  // returned path/name so the file↔version link stays correct even if renamed.
  const meta = await dbxUpload(path, audio.buffer, { ".tag": "add" }, true);
  return {
    versionNumber: version,
    fileName: meta.name ?? fileName,
    filePath: meta.path_display ?? path,
    extension: audio.ext,
    uploadedAt: new Date().toISOString(),
    sizeBytes: meta.size ?? audio.size,
  };
}

export async function createSketch(input: {
  title: string; description?: string; notes?: string; audio: UploadedAudio;
}): Promise<Sketch> {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) throw new SketchError("BAD_INPUT", "יש להזין שם לסקיצה");

  // Pre-check duplicate (cheap read) before uploading, to avoid orphan files.
  const { manifest: pre } = await readManifest();
  if (pre.sketches.some((s) => !s.archived && normTitle(s.title) === normTitle(title))) {
    throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
  }

  const id = randomUUID();
  const version = await uploadVersionFile(id, title, 1, input.audio); // file uploaded FIRST

  const now = new Date().toISOString();
  try {
    await mutateManifest((m) => {
      // Re-check under lock (race window since the pre-check).
      if (m.sketches.some((s) => !s.archived && normTitle(s.title) === normTitle(title))) {
        throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
      }
      m.sketches.push({
        id, title, description: (input.description ?? "").trim(), notes: (input.notes ?? "").trim(),
        createdAt: now, updatedAt: now,
        latestVersion: 1, latestFilePath: version.filePath, latestFileName: version.fileName,
        versions: [version], archived: false, archivedAt: null,
      });
      // New sketch goes to the TOP of the library, preserving the rest of the order.
      m.order = [id, ...effectiveOrder(m).filter((x) => x !== id)];
      return m;
    });
  } catch (e) {
    if (e instanceof SketchError && e.code === "DUP_TITLE") throw e;
    // File uploaded but manifest save failed — report honestly, do NOT auto-delete.
    console.error(`[sketches] ORPHAN after create — file ${version.filePath} saved but manifest not updated`);
    throw new SketchError("SAVE_FAILED", "הקובץ הועלה אך שמירת הסקיצה נכשלה. נסה שוב או פנה לתמיכה");
  }
  const created = (await readManifest()).manifest.sketches.find((s) => s.id === id);
  return created!;
}

export async function addVersion(id: string, audio: UploadedAudio): Promise<Sketch> {
  const { manifest } = await readManifest();
  const existing = manifest.sketches.find((s) => s.id === id && !s.archived);
  if (!existing) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");

  const nextVersion = existing.latestVersion + 1;
  const version = await uploadVersionFile(id, existing.title, nextVersion, audio); // upload FIRST

  try {
    await mutateManifest((m) => {
      // Freeze the current positions BEFORE bumping updatedAt so a new version
      // never moves the item (and legacy manifests gain a stable order now).
      const frozen = effectiveOrder(m);
      const s = m.sketches.find((x) => x.id === id);
      if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
      // Recompute against the CURRENT latest under lock (no duplicate version numbers).
      const vNum = s.latestVersion + 1;
      const v = { ...version, versionNumber: vNum };
      s.versions.push(v);
      s.latestVersion = vNum;
      s.latestFilePath = v.filePath;
      s.latestFileName = v.fileName;
      s.durationSeconds = undefined; // new version's length is unknown until played
      s.updatedAt = new Date().toISOString();
      m.order = frozen;
      return m;
    });
  } catch (e) {
    if (e instanceof SketchError && e.code === "NOT_FOUND") throw e;
    console.error(`[sketches] ORPHAN after version — file ${version.filePath} saved but manifest not updated`);
    throw new SketchError("SAVE_FAILED", "הקובץ הועלה אך עדכון הגרסה נכשל. נסה שוב או פנה לתמיכה");
  }
  return (await readManifest()).manifest.sketches.find((s) => s.id === id)!;
}

export async function patchDetails(id: string, patch: { title?: string; description?: string; notes?: string }): Promise<Sketch> {
  return (await mutateManifest((m) => {
    // Editing details never moves the item; freeze positions (also seeds a
    // stable order on a legacy manifest) before touching updatedAt.
    const frozen = effectiveOrder(m);
    const s = m.sketches.find((x) => x.id === id && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    if (patch.title !== undefined) {
      const t = patch.title.trim().replace(/\s+/g, " ");
      if (!t) throw new SketchError("BAD_INPUT", "שם הסקיצה לא יכול להיות ריק");
      if (m.sketches.some((x) => x.id !== id && !x.archived && normTitle(x.title) === normTitle(t))) {
        throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
      }
      s.title = t; // old files are NOT renamed; next version uses the new name.
    }
    if (patch.description !== undefined) s.description = patch.description.trim();
    if (patch.notes !== undefined) s.notes = patch.notes.trim();
    s.updatedAt = new Date().toISOString();
    m.order = frozen;
    return m;
  })).sketches.find((s) => s.id === id)!;
}

export async function softDeleteSketch(id: string): Promise<void> {
  await mutateManifest((m) => {
    const s = m.sketches.find((x) => x.id === id);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    s.archived = true;
    s.archivedAt = new Date().toISOString();
    s.updatedAt = s.archivedAt;
    // Drop it from the order without disturbing the remaining items' sequence.
    m.order = effectiveOrder(m);
    return m; // files stay in Dropbox; the record stays in the manifest as archived.
  });
}

/**
 * Reorder the ACTIVE library. The client sends only ids (never a path/manifest).
 * Server-side we reject unknown/archived/duplicate ids, and any active item the
 * client omitted (stale client) is preserved at the end so nothing is ever lost.
 */
export async function reorderSketches(orderedIds: string[]): Promise<Sketch[]> {
  if (!Array.isArray(orderedIds)) throw new SketchError("BAD_INPUT", "רשימת הסדר אינה תקינה");
  await mutateManifest((m) => {
    const activeIds = new Set(m.sketches.filter((s) => !s.archived).map((s) => s.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (typeof id !== "string" || !activeIds.has(id)) {
        throw new SketchError("BAD_INPUT", "רשימת הסדר מכילה פריט שאינו קיים בספרייה");
      }
      if (seen.has(id)) throw new SketchError("BAD_INPUT", "רשימת הסדר מכילה כפילויות");
      seen.add(id);
    }
    // Preserve any active item the client didn't include (append, deterministic).
    const rest = m.sketches
      .filter((s) => !s.archived && !seen.has(s.id))
      .sort(byUpdatedDesc)
      .map((s) => s.id);
    m.order = [...orderedIds, ...rest];
    return m;
  });
  return listSketches();
}

// ── Next release (manifest-stored pointer to an active sketch) ────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The resolved next release, or null when unset / pointing at a missing sketch. */
export async function getNextReleaseConfig(): Promise<ResolvedNextRelease | null> {
  const { manifest } = await readManifest();
  const nr = manifest.nextRelease;
  if (!nr) return null;
  const s = manifest.sketches.find((x) => x.id === nr.sketchId && !x.archived);
  if (!s) return null; // stale pointer (the sketch was deleted/archived)
  return { sketchId: s.id, title: s.title, releaseDate: nr.releaseDate, updatedAt: nr.updatedAt };
}
/** Set the next release to an ACTIVE sketch + a YYYY-MM-DD date. */
export async function setNextReleaseConfig(sketchId: string, releaseDate: string): Promise<ResolvedNextRelease> {
  if (typeof sketchId !== "string" || !sketchId) throw new SketchError("BAD_INPUT", "יש לבחור סקיצה");
  if (!DATE_RE.test(releaseDate) || Number.isNaN(new Date(`${releaseDate}T00:00:00`).getTime())) {
    throw new SketchError("BAD_INPUT", "תאריך הוצאה לא תקין");
  }
  let resolved: ResolvedNextRelease | null = null;
  await mutateManifest((m) => {
    const s = m.sketches.find((x) => x.id === sketchId && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    m.nextRelease = { sketchId, releaseDate, updatedAt: new Date().toISOString() };
    resolved = { sketchId, title: s.title, releaseDate, updatedAt: m.nextRelease.updatedAt };
    return m;
  });
  return resolved!;
}

export async function setSketchDuration(id: string, versionNumber: number, seconds: number): Promise<void> {
  if (!(seconds > 0 && seconds < 86400)) return; // ignore implausible values, no error
  await mutateManifest((m) => {
    const s = m.sketches.find((x) => x.id === id && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    const v = s.versions.find((x) => x.versionNumber === versionNumber);
    if (v) v.durationSeconds = seconds;
    if (versionNumber === s.latestVersion) s.durationSeconds = seconds;
    return m;
  });
}
