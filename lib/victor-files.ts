import "server-only";
import { createHash } from "crypto";
import type { VendorWork, FileLink } from "@/lib/types";

/**
 * Opaque, path-free file handles for the Victor supplier view.
 *
 * Victor must never receive a Dropbox path (it encodes /Projects/{artist}/
 * {project}/…). Instead each of his file objects carries a `fileRef` — a
 * deterministic hash of the real dropboxPath. There is NO stored mapping: the
 * server re-derives the hash for every file of the SAME work and matches, so a
 * ref only ever resolves within a work Victor already has access to, and it
 * can't be reversed into a path or forged for someone else's file.
 */

/** Stable opaque handle for a Dropbox path. */
export function fileRefOf(dropboxPath: string): string {
  return createHash("sha256").update(dropboxPath).digest("hex").slice(0, 24);
}

/** Resolve a fileRef back to its real dropboxPath, scoped to ONE work's own
 *  files (filesSent / filesReceived / briefFiles). Returns null if no match. */
export function resolveVictorFileRef(work: VendorWork, fileRef: string): string | null {
  if (!fileRef) return null;
  const all: FileLink[] = [
    ...(work.filesSent ?? []),
    ...(work.filesReceived ?? []),
    ...(work.briefFiles ?? []),
  ];
  for (const f of all) {
    if (f.dropboxPath && fileRefOf(f.dropboxPath) === fileRef) return f.dropboxPath;
  }
  return null;
}
