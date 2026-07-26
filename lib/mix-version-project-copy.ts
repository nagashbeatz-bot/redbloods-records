import "server-only";
import { getProject } from "@/lib/projects-store";
import { projectBaseFolder } from "@/lib/project-paths";
import { buildVersionName } from "@/lib/project-file-naming";
import { commitFileToProject } from "@/lib/project-file-commit";

/**
 * Auto-duplicate a Steven FULL-MIX upload into the ORIGINAL project's player.
 * Called ONLY from lib/mix-version-upload.ts's finalizeMixVersion, ONLY when
 * the resolved role is "Mix" (never acapella/instrumental/stems/final-files)
 * and the work is linked to a real project. Project is resolved via
 * sound_engineer_work.project_id (the existing link) — NEVER by filename.
 *
 * Uses Dropbox's server-side files/copy_v2 (no bytes flow through our app) so
 * the ALREADY-uploaded mix_versions file becomes a second, independent file
 * under the project's own folder — naming (lib/project-file-naming.ts) and
 * persistence (lib/project-file-commit.ts) are the EXACT SAME functions the
 * manual "Upload version" button on the project page uses. Never touches or
 * moves Steven's own copy.
 *
 * Best-effort: any failure here is logged and swallowed — it must never fail
 * or roll back Steven's mix-version upload.
 */
export async function duplicateFullMixToProject(args: {
  projectId: string;
  sourceDropboxPath: string;
  fileType: string;
  mixVersionId: string;
  token: string;
}): Promise<void> {
  const { projectId, sourceDropboxPath, fileType, mixVersionId, token } = args;
  try {
    const project = await getProject(projectId);
    if (!project) {
      console.error(`[mix-to-project-copy] project ${projectId} not found — skipping duplication`);
      return;
    }

    // Idempotency: never duplicate the same mix_versions row twice (retry,
    // refresh, or a duplicate call all land on the same mixVersionId).
    const existingFiles = project.files ?? [];
    if (existingFiles.some((f) => f.sourceMixVersionId === mixVersionId)) {
      console.log(`[mix-to-project-copy] mix version ${mixVersionId} already copied to project ${projectId} — skipping`);
      return;
    }

    const newName = buildVersionName(project.artist, project.name, existingFiles, fileType, project.status);
    const folder = projectBaseFolder(project.artist, project.name, projectId, project.dropboxFolder);
    const destPath = `${folder}/${newName}`;

    const copyRes = await fetch("https://api.dropboxapi.com/2/files/copy_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: sourceDropboxPath, to_path: destPath, autorename: true }),
    });
    if (!copyRes.ok) {
      const t = await copyRes.text();
      console.error(`[mix-to-project-copy] Dropbox copy failed (project ${projectId}, version ${mixVersionId}): ${t}`);
      return;
    }
    const copied = (await copyRes.json()) as { metadata: { path_display: string; name: string } };
    const finalPath = copied.metadata.path_display;
    const finalName = copied.metadata.name; // may differ from newName if Dropbox autorenamed on a clash

    await commitFileToProject(token, projectId, finalPath, finalName, { sourceMixVersionId: mixVersionId });
    console.log(`[mix-to-project-copy] copied mix version ${mixVersionId} to project ${projectId} as "${finalName}"`);
  } catch (err) {
    console.error(`[mix-to-project-copy] failed (project ${projectId}, version ${mixVersionId}):`, err);
  }
}
