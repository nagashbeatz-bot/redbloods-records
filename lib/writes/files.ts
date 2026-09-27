/**
 * Shared writers for project files that ALREADY exist (Sunny never uploads bytes — the file channel is a Boss decision).
 * Files are addressed by a server-computed handle (`fileRef` = sha256 of the stored path, 24 hex chars) — a path never
 * leaves this module and is never accepted from Sunny. HARDENED (2026-09-27, Universal Actions):
 *   • deleteProjectFileByPath refuses a path that is not the project's own: it must be a listed file of the project, a
 *     path inside the project's own folder (never the folder itself), or a folder that holds listed files at least one
 *     level below /Projects/<artist>/<project>; ".." / relative paths are refused. It used to delete ANY path.
 */
import { createHash } from "node:crypto";
import type { FileLink, WorkMaterialsMeta } from "@/lib/types";

export class FilePathError extends Error {}
export const fileRefOf = (path: string) => createHash("sha256").update(path).digest("hex").slice(0, 24);
const norm = (p: string) => p.trim().replace(/\/+$/, "").toLowerCase();

async function project(projectId: string) {
  const { getProject } = await import("@/lib/projects-store");
  return getProject(projectId);
}
export interface ProjectFileMeta { ref: string; name: string; category: string | null; versionLabel: string | null; trackId: string | null; size: number | null; durationSeconds: number | null; uploadedAt: string | null }
/** Metadata only — never the path or a link. */
export async function projectFilesMeta(projectId: string): Promise<ProjectFileMeta[] | null> {
  const p = await project(projectId);
  if (!p) return null;
  return ((p.files ?? []) as FileLink[]).filter((f) => !!f.dropboxPath).map((f) => ({
    ref: fileRefOf(f.dropboxPath!), name: f.name, category: f.category ?? null, versionLabel: f.versionLabel ?? null, trackId: f.trackId ?? null,
    size: f.size ?? null, durationSeconds: f.durationSeconds ?? null, uploadedAt: f.uploadedAt ?? null,
  }));
}
/** Server-side only: the stored path behind a handle (null when the project has no such file). */
export async function projectFilePath(projectId: string, ref: string): Promise<string | null> {
  const p = await project(projectId);
  return ((p?.files ?? []) as FileLink[]).find((f) => f.dropboxPath && fileRefOf(f.dropboxPath) === ref)?.dropboxPath ?? null;
}

/** HARDENED path check for the project delete route. */
export async function assertDeletableProjectPath(projectId: string, path: string): Promise<void> {
  if (!path.startsWith("/") || /(^|\/)\.\.?(\/|$)/.test(path)) throw new FilePathError("נתיב לא תקין");
  const p = await project(projectId);
  if (!p) throw new FilePathError("הפרויקט לא נמצא");
  const { projectBaseFolder } = await import("@/lib/project-paths");
  const base = norm(projectBaseFolder(p.artist ?? "", p.name ?? "", p.id, p.dropboxFolder ?? null));
  const target = norm(path);
  const listed = ((p.files ?? []) as FileLink[]).map((f) => f.dropboxPath).filter((x): x is string => !!x).map(norm);
  const ok = listed.includes(target)
    || (target.startsWith(`${base}/`) && target !== base)
    || (target.split("/").length >= 5 && listed.some((f) => f.startsWith(`${target}/`)));
  if (!ok) throw new FilePathError("הנתיב אינו קובץ / תיקייה של הפרויקט הזה");
}

/** POST /api/dropbox/delete semantics (after the path check): un-link the artist library FIRST, delete, drop the record. */
export async function deleteProjectFileByPath(projectId: string, dropboxPath: string): Promise<{ unlinked: number }> {
  await assertDeletableProjectPath(projectId, dropboxPath);
  const { unlinkProjectPathFromArtist } = await import("@/lib/red-artists/project-link");
  let removed = 0;
  try {
    const r = await unlinkProjectPathFromArtist(projectId, dropboxPath);
    removed = r.removed;
    if (r.removed > 0) console.log(`[dropbox/delete] unlinked ${r.removed} sketch version(s) for ${r.artistName} [${r.sketchIds.join(", ")}]`);
  } catch (e) {
    console.error("[dropbox/delete] artist un-link failed — aborting delete:", e instanceof Error ? e.message : e);
    throw new Error("לא ניתן לעדכן את ספריית האמן — המחיקה בוטלה, נסה שוב");
  }
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: dropboxPath }),
  });
  if (!delRes.ok) {
    console.error("[dropbox/delete] Dropbox error:", await delRes.text());
    throw new Error("שגיאה במחיקה מ-Dropbox");
  }
  const { removeFileFromProjectByPath } = await import("@/lib/projects-store");
  await removeFileFromProjectByPath(projectId, dropboxPath);
  return { unlinked: removed };
}

// ── work materials (BPM / key / instructions sent to the engineer) ──
export async function readWorkMaterials(projectId: string): Promise<WorkMaterialsMeta | null> {
  const p = await project(projectId);
  return p ? ((p.workMaterials ?? {}) as WorkMaterialsMeta) : null;
}
export async function setWorkMaterials(projectId: string, patch: WorkMaterialsMeta): Promise<void> {
  const { updateProjectWorkMaterials } = await import("@/lib/projects-store");
  await updateProjectWorkMaterials(projectId, patch);
}

// ── an existing project file → the artist's "My music", by reference ──
/** The link-enabled portal of the project's PRIMARY artist (null → not linkable). */
export async function portalOfProject(projectId: string): Promise<{ artistName: string; slug: string } | null> {
  const { resolveLinkableProject } = await import("@/lib/red-artists/project-link");
  const { slugForPortalArtistName } = await import("@/lib/red-artists/portal-registry");
  const l = await resolveLinkableProject(projectId);
  const slug = l ? slugForPortalArtistName(l.artistName) : null;
  return l && slug ? { artistName: l.artistName, slug } : null;
}
/** POST …/sketches/project-link semantics (the Owner gate stays in the route): the file must be the project's own. */
export async function linkProjectFileToPortal(artistName: string, slug: string, projectId: string, dropboxPath: string, sketchId: string, newTitle: string) {
  const { resolveLinkableProject, findProjectFileByPath } = await import("@/lib/red-artists/project-link");
  const { linkProjectFileAsVersion, createSketchFromProjectFile, SketchError } = await import("@/lib/red-artists/sketches-store");
  const linkable = await resolveLinkableProject(projectId);
  if (!linkable) throw new FilePathError("הפרויקט אינו שייך לאמן עם פורטל");
  if (linkable.artistName !== artistName) throw new FilePathError(`הפרויקט אינו של ${artistName}`);
  const file = findProjectFileByPath(linkable.project, dropboxPath);
  if (!file?.dropboxPath) throw new FilePathError("הקובץ לא נמצא בפרויקט");
  const ref = {
    filePath: file.dropboxPath, fileName: file.name, projectId: linkable.project.id,
    ...(file.size ? { sizeBytes: file.size } : {}), ...(file.durationSeconds ? { durationSeconds: file.durationSeconds } : {}),
  };
  if (sketchId) {
    if (!/^[0-9a-fA-F-]{36}$/.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    return linkProjectFileAsVersion(slug, sketchId, ref);
  }
  return createSketchFromProjectFile(slug, newTitle || linkable.project.name, ref);
}
