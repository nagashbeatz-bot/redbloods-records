/**
 * Shared mix-version upload core — server-only. Extracted from the owner
 * versions route so BOTH the owner route (/api/sound-engineer/[id]/versions) and
 * the scoped supplier route (/api/supplier/steven/work/[id]/versions) run the
 * exact same, tested upload path. Auth + ownership are the CALLER's job; this
 * function assumes the caller already authorized the write for `workId`.
 *
 * Behaviour is byte-for-byte what the owner route did before extraction: file
 * goes to the ORIGINAL project's /Mix Versions/ folder (work_title NEVER used for
 * the path), metadata only in mix_versions, no public share link, compensating
 * delete if the DB insert fails.
 */
import "server-only";
import { mixVersionsFolder, sanitizeFolder } from "@/lib/project-paths";
import { createMixVersion } from "@/lib/mix-versions-store";
import type { MixVersion } from "@/lib/types";

export const AUDIO_ZIP = /\.(wav|mp3|m4a|aiff?|flac|ogg|zip|rar|7z)$/i;

/** Escape non-ASCII for the Dropbox-API-Arg header (headers must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

type RoleKey = "mix" | "acapella" | "instrumental" | "stems";
const ROLE_EN: Record<RoleKey, string> = { mix: "Mix", acapella: "Acapella", instrumental: "Instrumental", stems: "Stems" };

/** Role KEY inferred from the ORIGINAL filename — fallback when no explicit role. */
function roleKeyFromName(name: string): RoleKey {
  const s = (name || "").toLowerCase();
  if (/(\.(zip|rar|7z)$|stems|ערוצים)/.test(s)) return "stems";
  if (/(instrumental|\binst\b|\bbeat\b|karaoke|אינסטרומנטל|אינסטרו|ביט)/.test(s)) return "instrumental";
  if (/(acapella|accapella|acappella|acapela|\bvocals?\b|\bvox\b|אקפלה|אקאפלה|ווקאל|וקאל|שירה)/.test(s)) return "acapella";
  return "mix";
}
/** Resolve the English role label: explicit client role (validated) → else from filename. */
function resolveRoleEn(roleParam: string | null, fileName: string): string {
  const p = (roleParam ?? "").trim().toLowerCase();
  if (p === "mix" || p === "acapella" || p === "instrumental" || p === "stems") return ROLE_EN[p];
  return ROLE_EN[roleKeyFromName(fileName)];
}

export type UploadResult =
  | { ok: true; version: MixVersion }
  | { ok: false; status: number; error: string };

/** Upload one file as a mix version for `workId`. Caller must have authorized. */
export async function uploadMixVersionFile(
  workId: string,
  input: { file: File; label: string; addToExisting: boolean; roleParam: string | null; durationSeconds: number | null }
): Promise<UploadResult> {
  const { file, label, addToExisting, roleParam, durationSeconds } = input;

  if (!file)                     return { ok: false, status: 400, error: "חסר קובץ" };
  if (!AUDIO_ZIP.test(file.name)) return { ok: false, status: 400, error: "סוג קובץ לא נתמך (WAV/MP3/AIFF/M4A/FLAC/OGG/ZIP)" };

  // Resolve work → project (for the path). NEVER use work_title here.
  const { supabase } = await import("@/lib/supabase");
  const { data: work } = await supabase
    .from("sound_engineer_work")
    .select("id, project_id, engineer_name")
    .eq("id", workId)
    .maybeSingle();
  if (!work) return { ok: false, status: 404, error: "עבודה לא נמצאה" };

  const projectId = (work.project_id as string | null) ?? null;
  let artist = "", projectName = "";
  let dropboxFolder: string | null = null; // frozen project base folder (rename-proof)
  if (projectId) {
    const { getProject } = await import("@/lib/projects-store");
    const project = await getProject(projectId);
    artist      = project?.artist ?? "";
    projectName = project?.name ?? "";
    dropboxFolder = project?.dropboxFolder ?? null;
  }

  const versionId = crypto.randomUUID();
  const dot       = file.name.lastIndexOf(".");
  const ext       = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";

  const { data: existingRows } = await supabase
    .from("mix_versions").select("label, file_name").eq("sound_engineer_work_id", workId);
  const existingLabels = new Set((existingRows ?? []).map(r => (r.label as string)));
  const existingNames  = new Set((existingRows ?? []).map(r => (r.file_name as string)));

  let effectiveLabel = label;
  if (!effectiveLabel) {
    let n = 1;
    while (existingLabels.has(`Mix ${n}`)) n++;
    effectiveLabel = `Mix ${n}`;
  } else if (existingLabels.has(effectiveLabel) && !addToExisting) {
    return { ok: false, status: 409, error: "כבר קיימת גרסה בשם הזה" };
  }

  const safeLabel   = sanitizeFolder(effectiveLabel) || "Mix";
  const roleEn      = resolveRoleEn(roleParam, file.name);
  const projLabel   = [projectName, effectiveLabel].map(s => sanitizeFolder(s)).filter(Boolean).join(" ") || safeLabel;
  const withRole    = [projLabel, sanitizeFolder(roleEn)].filter(Boolean).join(" ");
  const baseName    = roleEn === "Mix" ? projLabel : withRole; // plain mix → no role word
  let cleanFileName = ext ? `${baseName}.${ext}` : baseName;
  for (let n = 2; existingNames.has(cleanFileName); n++) {
    const numbered = `${withRole} ${n}`;
    cleanFileName = ext ? `${numbered}.${ext}` : numbered;
  }

  const folder      = mixVersionsFolder({ projectId, artist, projectName, workId, dropboxFolder });
  const dropboxPath = `${folder}/${cleanFileName}`;

  // ── Upload to Dropbox (token server-side; no share link) ──────────────────
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token  = await getDropboxToken();
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization:     `Bearer ${token}`,
      "Content-Type":    "application/octet-stream",
      "Dropbox-API-Arg": dropboxArg({ path: dropboxPath, mode: "add", autorename: true, mute: false }),
    },
    body: buffer,
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    let detail = t; try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
    return { ok: false, status: 500, error: `Dropbox: ${detail}` };
  }
  const uploaded  = (await uploadRes.json()) as { path_display: string; name: string };
  const finalPath = uploaded.path_display;

  const fileType = ["wav", "mp3", "m4a", "aiff", "aif", "flac", "ogg"].includes(ext)
    ? ext : (ext === "zip" ? "zip" : "other");

  // ── Persist metadata ONLY in mix_versions ─────────────────────────────────
  try {
    const version = await createMixVersion({
      id:                  versionId,
      soundEngineerWorkId: workId,
      projectId,
      label:               effectiveLabel,
      fileName:            cleanFileName,
      dropboxPath:         finalPath,
      fileSize:            file.size,
      fileType,
      uploadedBy:          (work.engineer_name as string | null) ?? null,
      durationSeconds,
    });
    return { ok: true, version };
  } catch (dbErr) {
    // Compensating: DB insert failed after upload → delete the orphaned file.
    try {
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: finalPath }),
      });
    } catch { /* best-effort */ }
    throw dbErr;
  }
}
