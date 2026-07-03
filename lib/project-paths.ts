// ── Canonical Dropbox folder paths for a project (app-folder-relative) ─────────
// Single source of truth shared by manual upload (/api/dropbox/upload), Steven
// intake (/api/dropbox/intake) and the delivery helper (/api/delivery) so they
// all write to the SAME place: /Projects/{primaryArtist}/{projectName}/...

/** Sanitize a string for use as a Dropbox FOLDER name (keeps Hebrew, drops path-illegal chars). */
export function sanitizeFolder(s: string): string {
  return (s || "").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
}

/** First (primary) artist from a comma/semicolon-separated artist string. */
export function primaryArtist(raw: string): string {
  return (raw || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
}

/**
 * Canonical project folder: /Projects/{primaryArtist}/{projectName}.
 * Falls back to /Projects/ללא אמן/... when the artist is missing, and to a
 * projectId-based name when even the project name is empty (matches the
 * long-standing manual-upload behavior).
 */
export function projectBaseFolder(artist: string, projectName: string, projectId: string): string {
  const a = sanitizeFolder(primaryArtist(artist));
  const p = sanitizeFolder(projectName);
  if (a && p) return `/Projects/${a}/${p}`;
  if (p)      return `/Projects/ללא אמן/${p}`;
  return `/Projects/ללא אמן/Untitled Project - ${(projectId || "").slice(0, 8)}`;
}

/** Delivery subfolder under the canonical project folder: …/Delivery */
export function deliveryFolder(artist: string, projectName: string, projectId: string): string {
  return `${projectBaseFolder(artist, projectName, projectId)}/Delivery`;
}

/**
 * Steven/Bill mix-versions folder (Phase 2). Physically inside the ORIGINAL
 * project's folder, in a dedicated "Mix Versions" subfolder (separate from
 * Delivery). NEVER uses sound_engineer_work.work_title — that is display-only,
 * so renaming a Steven work never moves the files. Standalone works (no project)
 * fall back to a workId-scoped folder so the path is rename-proof.
 */
export function mixVersionsFolder(opts: {
  projectId: string | null;
  artist?: string;
  projectName?: string;
  workId: string;
}): string {
  if (opts.projectId) {
    return `${projectBaseFolder(opts.artist ?? "", opts.projectName ?? "", opts.projectId)}/Mix Versions`;
  }
  return `/Sound Engineer/${opts.workId}/Mix Versions`;
}
