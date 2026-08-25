import "server-only";
import { randomUUID } from "crypto";
import { getDropboxToken } from "@/lib/dropbox-token";
import { sanitizeFolder } from "@/lib/project-paths";

/**
 * "המוזיקה שלי" store — a Dropbox-backed manifest is the SINGLE SOURCE OF TRUTH
 * (no Projects, no DB). All reads/writes are server-side; the client never
 * sends a path or manages version numbers.
 *
 * Multi-artist: every function takes an explicit `slug` (from
 * lib/red-artists/portal-config.ts) so each portal artist gets a completely
 * separate manifest/file tree — never shared, never cross-visible:
 *
 *   files:    /app/red-artists/{slug}/uploads/sketches/{id}/{title} V{n}.{ext}
 *   manifest: /app/red-artists/{slug}/uploads/sketches/manifest.json
 *
 * Shalev's slug ("shalev-tasama") is the exact literal his existing production
 * data already lives under — passing it here reproduces the original paths
 * byte-for-byte, so his data needs no migration.
 *
 * Concurrency: manifest writes are conditional on the Dropbox file `rev`
 * (mode=update{rev}); a rev clash → read-modify-write retry. A brand-new manifest
 * is created with mode=add. Corrupt manifest is NEVER silently overwritten.
 */

function rootFor(slug: string): string { return `/app/red-artists/${slug}/uploads/sketches`; }
function manifestPathFor(slug: string): string { return `${rootFor(slug)}/manifest.json`; }

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
  /** Set ONLY on a version that REFERENCES a file already uploaded through
   *  Projects (/api/dropbox/upload). The bytes live at `filePath` under
   *  /Projects/... and are NEVER copied into the artist's own tree — one
   *  physical file, two views. Absent on every normally-uploaded version. */
  source?: "project";
  /** The projects.id whose `files` entry this version points at (source="project" only). */
  sourceProjectId?: string;
}
/** Optional companion "beat / instrumental" for a sketch project. A single file
 *  attached to the project — NOT a version (never in `versions`, never counted,
 *  never the player's latest). Stored in the manifest like everything else. */
export interface SketchBeat {
  fileName: string;
  filePath: string;
  extension: string;
  uploadedAt: string;
  sizeBytes?: number;
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
  /** Optional companion beat/instrumental — separate from versions. */
  beat?: SketchBeat | null;
  archived: boolean;
  archivedAt?: string | null;
}
/** The portal's "next release" pointer — a sketch id + a release date (YYYY-MM-DD).
 * Stored in the manifest (single source of truth); no Projects / project_release_details. */
export interface NextReleaseRef { sketchId: string; releaseDate: string; updatedAt: string }
/** A NextReleaseRef resolved against the current sketches (adds the live title). */
export interface ResolvedNextRelease { sketchId: string; title: string; releaseDate: string; updatedAt: string }

/** The portal's "next project to work on" pointer — an OWNER-chosen sketch id + an
 * OPTIONAL owner-set deadline (YYYY-MM-DD | null). Stored in the manifest, fully
 * SEPARATE from nextRelease (never derived from it). */
export interface NextWorkRef { sketchId: string; deadline: string | null; updatedAt: string }
/** A NextWorkRef resolved against the current sketches (adds the live title). */
export interface ResolvedNextWork { sketchId: string; title: string; deadline: string | null; updatedAt: string }

interface Manifest {
  schemaVersion: number;
  sketches: Sketch[];
  /** Explicit display order for ACTIVE sketches (stable ids). Absent on legacy
   * manifests → a deterministic order is derived (see `effectiveOrder`). */
  order?: string[];
  /** The chosen "next release" (points at one active sketch). Optional/absent. */
  nextRelease?: NextReleaseRef | null;
  /** The chosen "next project to work on" (points at one active sketch). Optional. */
  nextWork?: NextWorkRef | null;
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

/** Defensively parse an optional beat sub-object (absent/legacy → null). */
function normalizeBeat(raw: unknown): SketchBeat | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<SketchBeat>;
  if (typeof b.filePath !== "string" || !b.filePath) return null;
  return {
    fileName: typeof b.fileName === "string" && b.fileName ? b.fileName : (b.filePath.split("/").pop() ?? "beat"),
    filePath: b.filePath,
    extension: typeof b.extension === "string" ? b.extension : (extOf(b.filePath) || ""),
    uploadedAt: typeof b.uploadedAt === "string" ? b.uploadedAt : new Date().toISOString(),
    sizeBytes: typeof b.sizeBytes === "number" ? b.sizeBytes : undefined,
  };
}

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
    beat: normalizeBeat((raw as { beat?: unknown }).beat),
    archived: raw.archived === true,
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
  };
}

async function readManifest(slug: string): Promise<{ manifest: Manifest; rev: string | null }> {
  const dl = await dbxDownload(manifestPathFor(slug));
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
  // Preserve the nextWork pointer too (defensively) so sketch mutations never wipe it.
  const rawWork = (parsed as { nextWork?: unknown })?.nextWork;
  let nextWork: NextWorkRef | null = null;
  if (rawWork && typeof rawWork === "object") {
    const w = rawWork as Partial<NextWorkRef>;
    if (typeof w.sketchId === "string") {
      nextWork = { sketchId: w.sketchId, deadline: typeof w.deadline === "string" ? w.deadline : null, updatedAt: typeof w.updatedAt === "string" ? w.updatedAt : new Date().toISOString() };
    }
  }
  return { manifest: { schemaVersion: 1, sketches, order, nextRelease, nextWork }, rev: dl.rev };
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
async function mutateManifest(slug: string, fn: (m: Manifest) => Manifest): Promise<Manifest> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { manifest, rev } = await readManifest(slug);
    const next = fn(structuredClone(manifest));
    const body = Buffer.from(JSON.stringify(next, null, 2), "utf8");
    const mode: UploadMode = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
    try {
      await dbxUpload(manifestPathFor(slug), body, mode);
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
/** Active (non-archived) sketches in the manifest's effective display order, for the artist `slug`. */
export async function listSketches(slug: string): Promise<Sketch[]> {
  const { manifest } = await readManifest(slug);
  const pos = new Map(effectiveOrder(manifest).map((id, i) => [id, i]));
  return manifest.sketches
    .filter((s) => !s.archived)
    .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

async function uploadVersionFile(slug: string, id: string, title: string, version: number, audio: UploadedAudio): Promise<SketchVersion> {
  const fileName = `${safeBase(title)} V${version}.${audio.ext}`;
  const path = `${rootFor(slug)}/${id}/${fileName}`;
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

/** Upload the project's companion beat into the SAME per-sketch folder, named
 *  "{title} ביט.{ext}". add + autorename → never overwrites; the ACTUAL returned
 *  path/name is stored so the link stays correct. NOT a version. */
async function uploadBeatFile(slug: string, id: string, title: string, audio: UploadedAudio): Promise<SketchBeat> {
  const fileName = `${safeBase(title)} ביט.${audio.ext}`;
  const path = `${rootFor(slug)}/${id}/${fileName}`;
  const meta = await dbxUpload(path, audio.buffer, { ".tag": "add" }, true);
  return {
    fileName: meta.name ?? fileName,
    filePath: meta.path_display ?? path,
    extension: audio.ext,
    uploadedAt: new Date().toISOString(),
    sizeBytes: meta.size ?? audio.size,
  };
}

export async function createSketch(slug: string, input: {
  title: string; description?: string; notes?: string; audio: UploadedAudio; beat?: UploadedAudio;
}): Promise<Sketch> {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) throw new SketchError("BAD_INPUT", "יש להזין שם לסקיצה");

  // Pre-check duplicate (cheap read) before uploading, to avoid orphan files.
  const { manifest: pre } = await readManifest(slug);
  if (pre.sketches.some((s) => !s.archived && normTitle(s.title) === normTitle(title))) {
    throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
  }

  const id = randomUUID();
  const version = await uploadVersionFile(slug, id, title, 1, input.audio); // sketch file uploaded FIRST
  // Optional companion beat — uploaded now too (best-effort ordering: sketch
  // then beat), stored on the project. Never a version, never the player latest.
  const beat = input.beat ? await uploadBeatFile(slug, id, title, input.beat) : null;

  const now = new Date().toISOString();
  try {
    await mutateManifest(slug, (m) => {
      // Re-check under lock (race window since the pre-check).
      if (m.sketches.some((s) => !s.archived && normTitle(s.title) === normTitle(title))) {
        throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
      }
      m.sketches.push({
        id, title, description: (input.description ?? "").trim(), notes: (input.notes ?? "").trim(),
        createdAt: now, updatedAt: now,
        latestVersion: 1, latestFilePath: version.filePath, latestFileName: version.fileName,
        versions: [version], beat, archived: false, archivedAt: null,
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
  const created = (await readManifest(slug)).manifest.sketches.find((s) => s.id === id);
  return created!;
}

export async function addVersion(slug: string, id: string, audio: UploadedAudio): Promise<Sketch> {
  const { manifest } = await readManifest(slug);
  const existing = manifest.sketches.find((s) => s.id === id && !s.archived);
  if (!existing) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");

  const nextVersion = existing.latestVersion + 1;
  const version = await uploadVersionFile(slug, id, existing.title, nextVersion, audio); // upload FIRST

  try {
    await mutateManifest(slug, (m) => {
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
  return (await readManifest(slug)).manifest.sketches.find((s) => s.id === id)!;
}

/** Attach or replace the project's companion beat. Uploads the file then points
 *  the manifest at it. Deliberately does NOT touch versions / latestVersion /
 *  updatedAt / order — the beat must never change what the player plays, the
 *  sketch numbering, or the library order. */
export async function setBeat(slug: string, id: string, audio: UploadedAudio): Promise<Sketch> {
  const { manifest } = await readManifest(slug);
  const existing = manifest.sketches.find((s) => s.id === id && !s.archived);
  if (!existing) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
  const beat = await uploadBeatFile(slug, id, existing.title, audio); // upload FIRST
  await mutateManifest(slug, (m) => {
    const s = m.sketches.find((x) => x.id === id);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    s.beat = beat;
    return m;
  });
  return (await readManifest(slug)).manifest.sketches.find((s) => s.id === id)!;
}

export async function patchDetails(slug: string, id: string, patch: { title?: string; description?: string; notes?: string }): Promise<Sketch> {
  return (await mutateManifest(slug, (m) => {
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

export async function softDeleteSketch(slug: string, id: string): Promise<void> {
  await mutateManifest(slug, (m) => {
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
export async function reorderSketches(slug: string, orderedIds: string[]): Promise<Sketch[]> {
  if (!Array.isArray(orderedIds)) throw new SketchError("BAD_INPUT", "רשימת הסדר אינה תקינה");
  await mutateManifest(slug, (m) => {
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
  return listSketches(slug);
}

// ── Next release (manifest-stored pointer to an active sketch) ────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The resolved next release, or null when unset / pointing at a missing sketch. */
export async function getNextReleaseConfig(slug: string): Promise<ResolvedNextRelease | null> {
  const { manifest } = await readManifest(slug);
  const nr = manifest.nextRelease;
  if (!nr) return null;
  const s = manifest.sketches.find((x) => x.id === nr.sketchId && !x.archived);
  if (!s) return null; // stale pointer (the sketch was deleted/archived)
  return { sketchId: s.id, title: s.title, releaseDate: nr.releaseDate, updatedAt: nr.updatedAt };
}
/** Set the next release to an ACTIVE sketch + a YYYY-MM-DD date. */
export async function setNextReleaseConfig(slug: string, sketchId: string, releaseDate: string): Promise<ResolvedNextRelease> {
  if (typeof sketchId !== "string" || !sketchId) throw new SketchError("BAD_INPUT", "יש לבחור סקיצה");
  if (!DATE_RE.test(releaseDate) || Number.isNaN(new Date(`${releaseDate}T00:00:00`).getTime())) {
    throw new SketchError("BAD_INPUT", "תאריך הוצאה לא תקין");
  }
  let resolved: ResolvedNextRelease | null = null;
  await mutateManifest(slug, (m) => {
    const s = m.sketches.find((x) => x.id === sketchId && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    m.nextRelease = { sketchId, releaseDate, updatedAt: new Date().toISOString() };
    resolved = { sketchId, title: s.title, releaseDate, updatedAt: m.nextRelease.updatedAt };
    return m;
  });
  return resolved!;
}

// ── Next project to work on (manifest-stored, OWNER-chosen; SEPARATE from release) ──
/** The resolved next-work project, or null when unset / pointing at a missing sketch. */
export async function getNextWorkConfig(slug: string): Promise<ResolvedNextWork | null> {
  const { manifest } = await readManifest(slug);
  const nw = manifest.nextWork;
  if (!nw) return null;
  const s = manifest.sketches.find((x) => x.id === nw.sketchId && !x.archived);
  if (!s) return null; // stale pointer (the sketch was deleted/archived)
  return { sketchId: s.id, title: s.title, deadline: nw.deadline ?? null, updatedAt: nw.updatedAt };
}
/** Set the next-work project to an ACTIVE sketch + an OPTIONAL deadline (YYYY-MM-DD | null). */
export async function setNextWorkConfig(slug: string, sketchId: string, deadline: string | null): Promise<ResolvedNextWork> {
  if (typeof sketchId !== "string" || !sketchId) throw new SketchError("BAD_INPUT", "יש לבחור פרויקט");
  const dl = deadline && deadline.trim() ? deadline.trim() : null;
  if (dl && (!DATE_RE.test(dl) || Number.isNaN(new Date(`${dl}T00:00:00`).getTime()))) {
    throw new SketchError("BAD_INPUT", "תאריך דדליין לא תקין");
  }
  let resolved: ResolvedNextWork | null = null;
  await mutateManifest(slug, (m) => {
    const s = m.sketches.find((x) => x.id === sketchId && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הפרויקט לא נמצא");
    m.nextWork = { sketchId, deadline: dl, updatedAt: new Date().toISOString() };
    resolved = { sketchId, title: s.title, deadline: dl, updatedAt: m.nextWork.updatedAt };
    return m;
  });
  return resolved!;
}

export async function setSketchDuration(slug: string, id: string, versionNumber: number, seconds: number): Promise<void> {
  if (!(seconds > 0 && seconds < 86400)) return; // ignore implausible values, no error
  await mutateManifest(slug, (m) => {
    const s = m.sketches.find((x) => x.id === id && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    const v = s.versions.find((x) => x.versionNumber === versionNumber);
    if (v) v.durationSeconds = seconds;
    if (versionNumber === s.latestVersion) s.durationSeconds = seconds;
    return m;
  });
}

// ── Project-linked versions ───────────────────────────────────────────────────
// A version that POINTS AT a file already uploaded through Projects
// (/api/dropbox/upload) instead of holding its own copy. The bytes stay exactly
// where the Projects upload put them (/Projects/{artist}/{project}/…) — nothing
// is re-uploaded and nothing is copied with files/copy_v2, so there is ONE
// physical file that both views render. Only the manifest is written.
//
// By policy this is Avi Molla + Shalev Tasama only; that scoping lives in the
// route (lib/red-artists/project-link.ts + the LINK_ENABLED_NAMES check and the
// project↔portal match), not here, so this store stays the same generic
// slug-parameterized module it already was.

export interface ProjectFileRef {
  /** The EXISTING Dropbox path of the Projects upload. Never copied, never moved. */
  filePath: string;
  fileName: string;
  /** projects.id that owns the `files` entry at `filePath` (verified by the route). */
  projectId: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

export interface TitleMatch {
  /** The single active sketch whose title matches exactly, or null (0 or >1 hits). */
  match: { id: string; title: string; latestVersion: number } | null;
  /** true when MORE THAN ONE active sketch carries that title — never auto-pick. */
  ambiguous: boolean;
  /** Every active sketch (id + title) so the caller can offer an explicit choice. */
  sketches: { id: string; title: string }[];
}

/**
 * Exact title lookup — `normTitle` only (trim + collapse inner whitespace +
 * lowercase), the SAME comparison createSketch already uses to reject duplicate
 * titles. Deliberately NOT fuzzy: no prefix / substring / similarity matching,
 * so a project can never silently attach itself to the wrong sketch.
 */
export async function matchSketchByTitle(slug: string, title: string): Promise<TitleMatch> {
  const active = await listSketches(slug);
  const want = normTitle(title ?? "");
  const hits = want ? active.filter((s) => normTitle(s.title) === want) : [];
  return {
    match: hits.length === 1
      ? { id: hits[0].id, title: hits[0].title, latestVersion: hits[0].latestVersion }
      : null,
    ambiguous: hits.length > 1,
    sketches: active.map((s) => ({ id: s.id, title: s.title })),
  };
}

/** Build the manifest version entry for an already-uploaded Projects file. */
function projectVersionEntry(ref: ProjectFileRef, versionNumber: number): SketchVersion {
  return {
    versionNumber,
    fileName: ref.fileName,
    filePath: ref.filePath,
    extension: extOf(ref.fileName) || extOf(ref.filePath),
    uploadedAt: new Date().toISOString(),
    ...(ref.sizeBytes ? { sizeBytes: ref.sizeBytes } : {}),
    ...(ref.durationSeconds ? { durationSeconds: ref.durationSeconds } : {}),
    source: "project" as const,
    sourceProjectId: ref.projectId,
  };
}

/** True when `filePath` IS `target`, or sits under it (whole-folder delete). */
function pathMatches(filePath: string, target: string): boolean {
  return filePath === target || filePath.startsWith(`${target}/`);
}

/** Every sketch (incl. archived) that already references this exact path. */
function sketchesReferencing(m: Manifest, filePath: string): Sketch[] {
  return m.sketches.filter((s) => s.versions.some((v) => v.source === "project" && v.filePath === filePath));
}

/** Recompute latest* from the CURRENT versions array (after an add / remove). */
function refreshLatest(s: Sketch): void {
  const latest = s.versions.length
    ? s.versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a))
    : null;
  s.latestVersion = latest?.versionNumber ?? 0;
  s.latestFilePath = latest?.filePath ?? "";
  s.latestFileName = latest?.fileName ?? "";
  s.durationSeconds = latest?.durationSeconds;
}

/**
 * Attach an already-uploaded Projects file to an EXISTING sketch as V{n+1}.
 * No bytes move. Idempotent: linking the same path to the same sketch twice is
 * a no-op; linking a path another sketch already owns is refused.
 */
export async function linkProjectFileAsVersion(slug: string, sketchId: string, ref: ProjectFileRef): Promise<Sketch> {
  if (!ref.filePath || !ref.fileName) throw new SketchError("BAD_INPUT", "פרטי הקובץ חסרים");

  const { manifest: pre } = await readManifest(slug);
  if (!pre.sketches.some((s) => s.id === sketchId && !s.archived)) {
    throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
  }
  const owners = sketchesReferencing(pre, ref.filePath);
  if (owners.some((s) => s.id === sketchId)) {
    return pre.sketches.find((s) => s.id === sketchId)!; // already linked — no write
  }
  if (owners.length) throw new SketchError("DUP_TITLE", "הקובץ הזה כבר מקושר לסקיצה אחרת");

  await mutateManifest(slug, (m) => {
    // Freeze positions BEFORE touching updatedAt so linking never reorders the library.
    const frozen = effectiveOrder(m);
    const s = m.sketches.find((x) => x.id === sketchId && !x.archived);
    if (!s) throw new SketchError("NOT_FOUND", "הסקיצה לא נמצאה");
    // Re-check under lock (another writer may have linked it meanwhile).
    if (!s.versions.some((v) => v.source === "project" && v.filePath === ref.filePath)) {
      if (sketchesReferencing(m, ref.filePath).length) {
        throw new SketchError("DUP_TITLE", "הקובץ הזה כבר מקושר לסקיצה אחרת");
      }
      s.versions.push(projectVersionEntry(ref, s.latestVersion + 1));
      refreshLatest(s);
      s.updatedAt = new Date().toISOString();
    }
    m.order = frozen;
    return m;
  });

  return (await readManifest(slug)).manifest.sketches.find((s) => s.id === sketchId)!;
}

/**
 * Create a BRAND-NEW sketch whose V1 references an already-uploaded Projects
 * file. Same duplicate-title rule as createSketch; no bytes are uploaded.
 */
export async function createSketchFromProjectFile(slug: string, rawTitle: string, ref: ProjectFileRef): Promise<Sketch> {
  const title = (rawTitle ?? "").trim().replace(/\s+/g, " ");
  if (!title) throw new SketchError("BAD_INPUT", "יש להזין שם לסקיצה");
  if (!ref.filePath || !ref.fileName) throw new SketchError("BAD_INPUT", "פרטי הקובץ חסרים");

  const { manifest: pre } = await readManifest(slug);
  if (pre.sketches.some((s) => !s.archived && normTitle(s.title) === normTitle(title))) {
    throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
  }
  if (sketchesReferencing(pre, ref.filePath).length) {
    throw new SketchError("DUP_TITLE", "הקובץ הזה כבר מקושר לסקיצה אחרת");
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await mutateManifest(slug, (m) => {
    if (m.sketches.some((s) => !s.archived && normTitle(s.title) === normTitle(title))) {
      throw new SketchError("DUP_TITLE", "כבר קיימת סקיצה פעילה עם השם הזה");
    }
    if (sketchesReferencing(m, ref.filePath).length) {
      throw new SketchError("DUP_TITLE", "הקובץ הזה כבר מקושר לסקיצה אחרת");
    }
    const version = projectVersionEntry(ref, 1);
    m.sketches.push({
      id, title, description: "", notes: "",
      createdAt: now, updatedAt: now,
      latestVersion: 1, latestFilePath: version.filePath, latestFileName: version.fileName,
      durationSeconds: version.durationSeconds,
      versions: [version], beat: null, archived: false, archivedAt: null,
    });
    // New sketch goes to the TOP of the library, preserving the rest of the order.
    m.order = [id, ...effectiveOrder(m).filter((x) => x !== id)];
    return m;
  });

  return (await readManifest(slug)).manifest.sketches.find((s) => s.id === id)!;
}

export interface UnlinkResult { removed: number; sketchIds: string[] }

/**
 * Remove every PROJECT-LINKED version pointing at `dropboxPath` (or at a file
 * under it, when a whole folder is deleted). Called from the Projects delete
 * flow BEFORE the physical file is removed, so the manifest never keeps a
 * reference to bytes that no longer exist.
 *
 * Strictly path-based: only versions carrying source="project" AND that exact
 * path are touched — never a match by project / sketch NAME, never a version the
 * artist uploaded into their own tree. Survivors keep their version numbers
 * (those appear in file names and in the push text); latest* is recomputed so
 * the previous version becomes current and stays playable.
 */
export async function unlinkProjectFile(slug: string, dropboxPath: string): Promise<UnlinkResult> {
  if (!dropboxPath) return { removed: 0, sketchIds: [] };

  // Cheap pre-read: when nothing references the path the manifest is never written.
  const { manifest: pre } = await readManifest(slug);
  const hit = pre.sketches.some((s) =>
    s.versions.some((v) => v.source === "project" && pathMatches(v.filePath, dropboxPath)),
  );
  if (!hit) return { removed: 0, sketchIds: [] };

  let removed = 0;
  let sketchIds: string[] = [];
  await mutateManifest(slug, (m) => {
    removed = 0; sketchIds = []; // reset — mutateManifest may retry on a rev clash
    // Freeze positions BEFORE any updatedAt bump so unlinking never reorders.
    const frozen = effectiveOrder(m);
    for (const s of m.sketches) {
      const before = s.versions.length;
      s.versions = s.versions.filter((v) => !(v.source === "project" && pathMatches(v.filePath, dropboxPath)));
      if (s.versions.length === before) continue;
      removed += before - s.versions.length;
      sketchIds.push(s.id);
      refreshLatest(s);
      s.updatedAt = new Date().toISOString();
    }
    m.order = frozen;
    return m;
  });

  return { removed, sketchIds };
}
