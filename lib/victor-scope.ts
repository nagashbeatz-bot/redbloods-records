/**
 * Victor portal storage scope — the SERVER-SIDE authorization rules for every Victor file operation
 * (stream / download / delete / upload). Pure (no I/O) so it is unit-tested directly
 * (scripts/test-victor-portal-security.tsx).
 *
 * The trusted scope of a work is its own base folder, which only the server (ensureVendorFolder) or the
 * Owner writes. Victor cannot change it: his PATCH on a work is refused. The folder must have one of the two canonical
 * Victor shapes:
 *   linked project → /Projects/{artist}/{project}/Victor
 *   standalone     → /Projects/Victor/{work title}
 * A file is in scope only when its normalized path lies strictly INSIDE that folder. Anything malformed fails closed
 * (null / false), e.g. traversal segments, backslashes, control characters, empty segments or a relative path.
 */
import type { FileLink } from "@/lib/types";

const MAX_PATH = 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A work / record id must be a UUID before it reaches the database (malformed → 400/404, never a 500 probe). */
export function isWorkId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Canonical form of a Dropbox path, or null when it is not a safe absolute path. Comparison is done on the
 *  NFC-normalized, lower-cased form (Dropbox paths are case-insensitive). */
export function normalizeDropboxPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_PATH) return null;
  const p = raw.normalize("NFC");
  if (!p.startsWith("/")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(p)) return null;
  if (p.length > 1 && p.endsWith("/")) return null;
  const segs = p.slice(1).split("/");
  for (const s of segs) {
    if (s.length === 0) return null; // "//" or a trailing slash
    // ".", "..", "...", ". ." and friends: trailing dots / spaces are ignored by some file systems, so any segment
    // made only of dots and spaces is refused, never interpreted.
    if (/^[.\s]+$/.test(s)) return null;
  }
  return p;
}

const key = (p: string) => p.toLowerCase();

/** The work's base folder when it has a canonical Victor shape; otherwise null (fail closed). */
export function victorWorkRoot(folder: unknown): string | null {
  const p = normalizeDropboxPath(folder);
  if (!p) return null;
  const segs = p.slice(1).split("/");
  const k = segs.map((s) => s.toLowerCase());
  if (k[0] !== "projects") return null;
  if (segs.length === 3 && k[1] === "victor") return p; // standalone
  if (segs.length === 4 && k[3] === "victor") return p; // linked project
  return null;
}

/** True only when `path` lies strictly inside `root` (both normalized; case-insensitive). */
export function isWithinRoot(path: unknown, root: unknown): boolean {
  const p = normalizeDropboxPath(path);
  const r = victorWorkRoot(root);
  if (!p || !r) return false;
  return key(p).startsWith(key(r) + "/");
}

interface ScopedWork { vendorName?: string | null; dropboxFolder?: string | null; filesSent?: FileLink[] | null; filesReceived?: FileLink[] | null; briefFiles?: FileLink[] | null }

/** A work Victor may act on: an existing Victor work row. */
export function isVictorWork(work: ScopedWork | null | undefined): work is ScopedWork {
  return !!work && work.vendorName === "victor";
}

/** The Dropbox path of a file Victor may READ (stream / download) in this work, or null. The path must be one of the work's
 *  own stored file entries AND lie inside the work's canonical folder. */
export function victorReadablePath(work: ScopedWork | null | undefined, candidatePath: string | null): string | null {
  if (!isVictorWork(work) || !candidatePath) return null;
  const files = [...(work.filesSent ?? []), ...(work.filesReceived ?? []), ...(work.briefFiles ?? [])];
  const listed = files.some((f) => f.dropboxPath === candidatePath);
  return listed && isWithinRoot(candidatePath, work.dropboxFolder) ? candidatePath : null;
}

/** Victor may delete only a version file HE uploaded (uploadedBy = "victor", recorded server-side at upload) that lies inside
 *  the work's folder. Files the Owner uploaded, or older entries with no uploader record, are never deletable by Victor. */
export function victorMayDelete(work: ScopedWork | null | undefined, file: FileLink | null | undefined): boolean {
  if (!isVictorWork(work) || !file?.dropboxPath) return false;
  if (file.uploadedBy !== "victor") return false;
  return (work.filesSent ?? []).some((f) => f.dropboxPath === file.dropboxPath) && isWithinRoot(file.dropboxPath, work.dropboxFolder);
}

/** Upload buckets inside a work folder. Victor's uploads land only in these; the Owner keeps any plain bucket name. */
export const VICTOR_UPLOAD_BUCKETS = ["Production", "02_From_Victor"] as const;

/** The server-side destination of an upload, or null when it would leave the work folder. */
export function uploadDestination(root: unknown, subFolder: string | null | undefined, fileName: string, role: "owner" | "victor"): string | null {
  const r = victorWorkRoot(root);
  if (!r) return null;
  const clean = (subFolder ?? "").replace(/[^A-Za-z0-9_]/g, "");
  if (role === "victor" && !(VICTOR_UPLOAD_BUCKETS as readonly string[]).includes(clean)) return null;
  const name = fileName.replace(/[<>:"/\\|?*]/g, "_").normalize("NFC");
  const dest = clean ? `${r}/${clean}/${name}` : `${r}/${name}`;
  return isWithinRoot(dest, r) ? dest : null;
}

/** Victor may patch NOTHING on a work: every file / folder field is written server-side (upload, delete) or by the Owner. */
export function victorMayPatch(_body: unknown): boolean {
  return false;
}

/** The salary / payment fields of the month stats are Owner-only (the Victor view never shows them). */
export const OWNER_ONLY_STAT_FIELDS = ["monthlySalary", "salaryCurrency", "paymentStatus"] as const;
export function statsForVictor<T extends Record<string, unknown>>(stats: T): Omit<T, (typeof OWNER_ONLY_STAT_FIELDS)[number]> {
  const out: Record<string, unknown> = { ...stats };
  for (const k of OWNER_ONLY_STAT_FIELDS) delete out[k];
  return out as Omit<T, (typeof OWNER_ONLY_STAT_FIELDS)[number]>;
}
