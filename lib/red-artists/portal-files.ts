import "server-only";

/**
 * Non-sketch Dropbox-backed artist portal data — performance files, press-kit
 * link, profile image, the generic "upload" endpoint, and the scoped
 * stream/download guard. Extracted from the original Shalev-only route
 * handlers so BOTH his existing routes (app/api/red-artists/*, unchanged
 * behavior) and the new owner-driven artist-scoped routes
 * (app/api/label/artists/[artistId]/*) share the exact same logic —
 * parameterized by `slug` (lib/red-artists/portal-config.ts), never
 * duplicated. No DB, no schema change: everything lives under each artist's
 * OWN Dropbox subtree, /app/red-artists/{slug}/...
 */

function rootFor(slug: string): string { return `/app/red-artists/${slug}`; }
export function allowedPrefixFor(slug: string): string { return `${rootFor(slug)}/`; }

/** ASCII-only serialization for the Dropbox-API-Arg header (must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aif", "aiff"]);
function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

// ── Performance files (recursive audio listing) ───────────────────────────────
export type PerformanceFile = { name: string; path: string; url: string };
type DbxEntry = { ".tag"?: string; name: string; path_display?: string; path_lower?: string };

export async function listPerformanceFiles(slug: string): Promise<PerformanceFile[]> {
  const perf = `${rootFor(slug)}/performance-files`;
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const entries: DbxEntry[] = [];

  let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST", headers,
    body: JSON.stringify({ path: perf, recursive: true, limit: 2000 }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 409 || t.includes("path/not_found")) return []; // not created yet — not an error
    console.error("[portal-files] performance-files list:", t);
    throw new Error("שגיאה בטעינת הקבצים");
  }
  let data = (await res.json()) as { entries?: DbxEntry[]; has_more?: boolean; cursor?: string };
  entries.push(...(data.entries ?? []));
  while (data.has_more && data.cursor) {
    res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
      method: "POST", headers, body: JSON.stringify({ cursor: data.cursor }),
    });
    if (!res.ok) break;
    data = (await res.json()) as { entries?: DbxEntry[]; has_more?: boolean; cursor?: string };
    entries.push(...(data.entries ?? []));
  }

  return entries
    .filter((e) => e[".tag"] === "file" && AUDIO_EXT.has(extOf(e.name)))
    .map((e) => {
      const p = e.path_display ?? e.path_lower ?? `${perf}/${e.name}`;
      return { name: e.name, path: p, url: `/api/dropbox/stream?path=${encodeURIComponent(p)}` };
    });
}

// ── Press-kit shared link ─────────────────────────────────────────────────────
type LinkMeta = { url?: string };
async function sharing(token: string, endpoint: string, body: unknown): Promise<Response> {
  return fetch(`https://api.dropboxapi.com/2/sharing/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getOrCreatePressKitLink(slug: string): Promise<string | null> {
  const pressKit = `${rootFor(slug)}/press-kit`;
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();

  const mk = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: pressKit, autorename: false }),
  });
  if (!mk.ok) {
    const t = await mk.text();
    if (!t.includes("conflict")) console.error("[portal-files] press-kit create_folder:", t);
  }

  const res = await sharing(token, "create_shared_link_with_settings", { path: pressKit, settings: { requested_visibility: { ".tag": "public" } } });
  if (res.ok) {
    const d = (await res.json()) as LinkMeta;
    if (d.url) return d.url;
  } else {
    const body = (await res.json()) as { error_summary?: string; error?: { shared_link_already_exists?: { metadata?: LinkMeta } } };
    let url = body?.error?.shared_link_already_exists?.metadata?.url;
    if (!url) {
      const list = await sharing(token, "list_shared_links", { path: pressKit, direct_only: true });
      if (list.ok) {
        const ld = (await list.json()) as { links?: LinkMeta[] };
        url = ld.links?.[0]?.url;
      }
    }
    if (url) return url;
    console.error("[portal-files] press-kit link:", body.error_summary ?? "no url");
  }
  return null;
}

// ── Profile image (Dropbox is the source of truth) ────────────────────────────
const IMAGE_ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
export const PROFILE_IMAGE_MAX_BYTES = 150 * 1024 * 1024; // 150MB — Dropbox single-request /files/upload ceiling
export const PROFILE_IMAGE_MAX_LABEL = "150MB";

export interface ProfileImageEditor { zoom: number; position: { x: number; y: number }; originalExt?: string; originalFileName?: string; updatedAt?: string }
export interface ProfileImageGetResult {
  // The actually-displayed (cropped) avatar — deterministic per-slug path, the
  // single source of truth every surface (portal header, label-management
  // card) should read from. Non-null only once this artist has an editor.json
  // (i.e. has actually saved a crop at least once) — matches the same
  // existence signal `original` already relies on below.
  avatar: { path: string; url: string } | null;
  original: { path: string; url: string } | null;
  editor: { zoom: number; position: { x: number; y: number }; updatedAt: string | null } | null;
}
export type ImageUploadResult = { ok: true; contentType: string } | { ok: false; status: number; error: string };

async function dbxUpload(token: string, path: string, body: Blob): Promise<string> {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ path, mode: "overwrite", autorename: false, mute: true }) },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    let detail = t;
    try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
    throw new Error(`Dropbox: ${detail}`);
  }
  const j = (await res.json()) as { path_display?: string };
  return j.path_display ?? path;
}
async function dbxDownloadText(token: string, path: string): Promise<string | null> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": dropboxArg({ path }) },
  });
  if (!res.ok) return null;
  return await res.text();
}
function parseEditor(raw: string | null): ProfileImageEditor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ProfileImageEditor;
    if (typeof v?.zoom === "number" && typeof v?.position?.x === "number" && typeof v?.position?.y === "number") return v;
  } catch { /* ignore */ }
  return null;
}

/** Scoped stream URL — the caller decides which route prefix (Shalev's existing
 *  /api/red-artists/stream vs the new /api/label/artists/[id]/stream). */
export function profileImagePaths(slug: string) {
  const folder = `${rootFor(slug)}/profile-image`;
  return { folder, avatarPath: `${folder}/avatar.jpg`, editorPath: `${folder}/editor.json` };
}

export async function getProfileImage(slug: string, streamUrl: (path: string) => string): Promise<ProfileImageGetResult> {
  const { folder, avatarPath, editorPath } = profileImagePaths(slug);
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const meta = parseEditor(await dbxDownloadText(token, editorPath));
  const originalPath = meta?.originalExt ? `${folder}/original.${meta.originalExt}` : null;
  return {
    avatar: meta ? { path: avatarPath, url: streamUrl(avatarPath) } : null,
    original: originalPath ? { path: originalPath, url: streamUrl(originalPath) } : null,
    editor: meta ? { zoom: meta.zoom, position: meta.position, updatedAt: meta.updatedAt ?? null } : null,
  };
}

export async function saveProfileImage(slug: string, form: FormData): Promise<
  | { ok: true; path: string }
  | { ok: false; status: number; error: string }
> {
  const { folder, avatarPath, editorPath } = profileImagePaths(slug);
  const avatar = form.get("avatar") as File | null;
  if (!avatar) return { ok: false, status: 400, error: "חסר קובץ" };
  const avatarExt = IMAGE_ALLOWED[avatar.type];
  if (!avatarExt) return { ok: false, status: 415, error: "סוג קובץ לא נתמך — jpg / png / webp בלבד" };
  if (avatar.size > PROFILE_IMAGE_MAX_BYTES) return { ok: false, status: 413, error: `הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${PROFILE_IMAGE_MAX_LABEL})` };

  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();

  const avatarPathSaved = await dbxUpload(token, avatarPath, avatar);

  const original = form.get("original") as File | null;
  let originalExt: string | undefined;
  if (original) {
    originalExt = IMAGE_ALLOWED[original.type];
    if (!originalExt) return { ok: false, status: 415, error: "סוג קובץ לא נתמך — jpg / png / webp בלבד" };
    if (original.size > PROFILE_IMAGE_MAX_BYTES) return { ok: false, status: 413, error: `הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${PROFILE_IMAGE_MAX_LABEL})` };
    await dbxUpload(token, `${folder}/original.${originalExt}`, original);
  } else {
    originalExt = parseEditor(await dbxDownloadText(token, editorPath))?.originalExt;
  }

  const zoom = Number(form.get("zoom"));
  const posX = Number(form.get("posX"));
  const posY = Number(form.get("posY"));
  const originalFileName = (form.get("originalFileName") as string | null) || undefined;
  const meta: ProfileImageEditor = {
    zoom: Number.isFinite(zoom) ? zoom : 1,
    position: { x: Number.isFinite(posX) ? posX : 0, y: Number.isFinite(posY) ? posY : 0 },
    ...(originalExt ? { originalExt } : {}),
    ...(originalFileName ? { originalFileName } : {}),
    updatedAt: new Date().toISOString(),
  };
  await dbxUpload(token, editorPath, new Blob([JSON.stringify(meta)], { type: "application/json" }));

  return { ok: true, path: avatarPathSaved };
}

// ── Generic "upload" (performance / press-kit file drop) ─────────────────────
const PRESS_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "pdf", "txt", "doc", "docx"]);
export const UPLOAD_MAX_BYTES = 140 * 1024 * 1024;
export type UploadKind = "performance" | "pressKit";

/** Sanitize a filename for a Dropbox path segment (mirrors lib/project-paths.ts's
 *  sanitizeFolder intent, kept local + minimal — same rules already used here). */
function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?* -]/g, "_").trim();
}

export async function uploadArtistFile(slug: string, kind: UploadKind, file: File | null): Promise<
  | { ok: true; file: { name: string; path: string } }
  | { ok: false; status: number; error: string }
> {
  if (!file) return { ok: false, status: 400, error: "חסר קובץ" };
  const ext = extOf(file.name);
  const allowed = kind === "performance" ? AUDIO_EXT : PRESS_EXT;
  if (!allowed.has(ext)) {
    return { ok: false, status: 415, error: kind === "performance"
      ? "לקובץ הופעה ניתן להעלות אודיו בלבד (mp3, wav, m4a, ogg, flac, aif)"
      : "לחומרי יח״צ ניתן להעלות תמונות או מסמכים בלבד (jpg, png, webp, gif, pdf, txt, doc, docx)" };
  }
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, status: 413, error: "הקובץ גדול מדי (מקסימום 140MB)" };

  const safeName = sanitizeFileName(file.name) || `file.${ext}`;
  const path = `${rootFor(slug)}/${kind === "performance" ? "performance-files" : "press-kit"}/${safeName}`;

  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ path, mode: "add", autorename: true, mute: true }) },
    body: Buffer.from(await file.arrayBuffer()) as unknown as BodyInit,
  });
  if (!res.ok) {
    const t = await res.text();
    let detail = t; try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
    console.error("[portal-files] upload:", detail);
    return { ok: false, status: 500, error: `Dropbox: ${detail}` };
  }
  const j = (await res.json()) as { path_display?: string; name?: string };
  return { ok: true, file: { name: j.name ?? safeName, path: j.path_display ?? path } };
}

// ── Scoped stream/download guard ──────────────────────────────────────────────
/** True iff `path` is safely inside this artist's own Dropbox tree — the hard
 *  security boundary stream/download routes enforce (no traversal, no other
 *  artist's/project's files). */
export function isPathWithinArtist(slug: string, path: string): boolean {
  return !path.includes("..") && path.startsWith(allowedPrefixFor(slug));
}
