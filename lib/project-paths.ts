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
 *
 * `storedFolder` (projects.dropbox_folder) FREEZES the path: once a project has
 * one, it is the base folder regardless of the current name — so renaming a
 * project never moves/creates a Dropbox folder. When it's null/empty we fall
 * back to the name-derived path (unchanged legacy behavior), and to a
 * projectId-based name when even the project name is empty.
 */
export function projectBaseFolder(artist: string, projectName: string, projectId: string, storedFolder?: string | null): string {
  const frozen = (storedFolder ?? "").trim();
  if (frozen) return frozen;
  const a = sanitizeFolder(primaryArtist(artist));
  const p = sanitizeFolder(projectName);
  if (a && p) return `/Projects/${a}/${p}`;
  if (p)      return `/Projects/ללא אמן/${p}`;
  return `/Projects/ללא אמן/Untitled Project - ${(projectId || "").slice(0, 8)}`;
}

/** Delivery subfolder under the canonical project folder: …/Delivery */
export function deliveryFolder(artist: string, projectName: string, projectId: string, storedFolder?: string | null): string {
  return `${projectBaseFolder(artist, projectName, projectId, storedFolder)}/Delivery`;
}

/**
 * Work-materials subfolder under the canonical project folder: …/Instructions.
 * This is what Redbloods SENDS to the sound engineer (Rough Mix, References,
 * Stems, Instructions) — separate from …/Delivery and …/Mix Versions.
 */
export function instructionsFolder(artist: string, projectName: string, projectId: string, storedFolder?: string | null): string {
  return `${projectBaseFolder(artist, projectName, projectId, storedFolder)}/Instructions`;
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
  dropboxFolder?: string | null; // frozen project base folder (projects.dropbox_folder)
}): string {
  if (opts.projectId) {
    return `${projectBaseFolder(opts.artist ?? "", opts.projectName ?? "", opts.projectId, opts.dropboxFolder)}/Mix Versions`;
  }
  return `/Sound Engineer/${opts.workId}/Mix Versions`;
}
