import "server-only";
import { finalFilesFolder } from "@/lib/project-paths";
import { dropboxArg } from "@/lib/mix-version-upload";
import { finalFileNameExists, createFinalFile, type FinalFile } from "@/lib/final-files-store";

/**
 * "Upload Final Files" upload core — server-only, SEPARATE from mix versions.
 *
 * - Keeps the EXACT original filename (no rename; no project/label/Mix/role/number).
 * - Stores under the work/project's /Final Files/ folder.
 * - Dropbox mode:add + autorename:false → a name clash is a hard error, never a silent
 *   rename/overwrite. Case-insensitive dedupe is also enforced pre-upload (DB) and by the
 *   unique indexes on lower(file_name)/lower(dropbox_path).
 * - Orphan-safe: bytes go to Dropbox first, then the final_files row; if the insert fails
 *   the just-uploaded file is deleted (compensating).
 * - Persists ONLY in final_files — never mix_versions.
 */

/** Bilingual-safe conflict copy (server returns HE; client localizes by status 409). */
export const FINAL_CONFLICT_MSG = "כבר קיים קובץ בשם הזה בתיקיית הקבצים הסופיים.";

/** Validate the ORIGINAL filename WITHOUT changing it (validation ≠ rename). */
export function validateFinalFileName(name: string): string | null {
  const n = (name ?? "").trim();
  if (!n) return "שם קובץ ריק";
  if (n === "." || n === "..") return "שם קובץ לא תקין";
  if (n.includes("/") || n.includes("\\")) return "שם קובץ לא תקין (מכיל / או \\)";
  return null;
}

function extType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : null;
}

export type FinalTarget = { projectId: string | null; engineerName: string | null; folder: string };
export type TargetResult = { ok: true; target: FinalTarget } | { ok: false; status: number; error: string };

/** Resolve the /Final Files/ folder for a work (same work/project hierarchy). */
export async function resolveFinalTarget(workId: string): Promise<TargetResult> {
  const { supabase } = await import("@/lib/supabase");
  const { data: work } = await supabase
    .from("sound_engineer_work")
    .select("id, project_id, engineer_name")
    .eq("id", workId)
    .maybeSingle();
  if (!work) return { ok: false, status: 404, error: "עבודה לא נמצאה" };

  const projectId = (work.project_id as string | null) ?? null;
  let artist = "", projectName = "", dropboxFolder: string | null = null;
  if (projectId) {
    const { getProject } = await import("@/lib/projects-store");
    const project = await getProject(projectId);
    artist = project?.artist ?? "";
    projectName = project?.name ?? "";
    dropboxFolder = project?.dropboxFolder ?? null;
  }
  const folder = finalFilesFolder({ projectId, artist, projectName, workId, dropboxFolder });
  return { ok: true, target: { projectId, engineerName: (work.engineer_name as string | null) ?? null, folder } };
}

export type FinalUploadResult =
  | { ok: true; file: FinalFile }
  | { ok: false; status: number; error: string };

async function dropboxDelete(token: string, path: string): Promise<void> {
  try {
    await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch { /* best-effort */ }
}

/**
 * Persist a final file whose bytes are ALREADY at `finalPath` in Dropbox. On a
 * unique (name/path) violation the just-uploaded file is deleted and 409 is returned.
 * Shared by the single-shot and chunked finish paths.
 */
export async function finalizeFinalFile(args: {
  workId: string; target: FinalTarget; fileName: string; finalPath: string;
  fileSize: number | null; token: string;
}): Promise<FinalUploadResult> {
  const res = await createFinalFile({
    workId: args.workId,
    projectId: args.target.projectId,
    fileName: args.fileName,
    dropboxPath: args.finalPath,
    fileSize: args.fileSize,
    fileType: extType(args.fileName),
    uploadedBy: args.target.engineerName,
  });
  if (res.status === "duplicate") {
    await dropboxDelete(args.token, args.finalPath);   // compensating: remove the orphan
    return { ok: false, status: 409, error: FINAL_CONFLICT_MSG };
  }
  return { ok: true, file: res.file };
}

/**
 * Single-shot upload (≤150MB) of one final file, keeping the original name. Caller
 * must have authorized the write for `workId`.
 */
export async function uploadFinalFileSingle(workId: string, file: File): Promise<FinalUploadResult> {
  if (!file) return { ok: false, status: 400, error: "חסר קובץ" };
  const nameErr = validateFinalFileName(file.name);
  if (nameErr) return { ok: false, status: 400, error: nameErr };

  const resolved = await resolveFinalTarget(workId);
  if (!resolved.ok) return resolved;
  const { target } = resolved;

  // Pre-upload dedupe gate (case-insensitive) — avoid uploading a byte on a known clash.
  if (await finalFileNameExists(workId, file.name)) {
    return { ok: false, status: 409, error: FINAL_CONFLICT_MSG };
  }

  const dropboxPath = `${target.folder}/${file.name}`;
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      // autorename:false → a name clash is a hard Dropbox error (never a silent rename).
      "Dropbox-API-Arg": dropboxArg({ path: dropboxPath, mode: "add", autorename: false, mute: false }),
    },
    body: buffer,
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    // Dropbox path/conflict → treat as the same "already exists" conflict.
    if (/conflict/i.test(t)) return { ok: false, status: 409, error: FINAL_CONFLICT_MSG };
    let detail = t; try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
    return { ok: false, status: 500, error: `Dropbox: ${detail}` };
  }
  const uploaded = (await uploadRes.json()) as { path_display: string };
  return finalizeFinalFile({ workId, target, fileName: file.name, finalPath: uploaded.path_display, fileSize: file.size, token });
}
