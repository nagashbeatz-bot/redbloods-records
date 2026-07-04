import "server-only";
import { getVictorWorkById, updateVictorWork } from "@/lib/vendor-store";
import { getDropboxToken } from "@/lib/dropbox-token";

/**
 * Server-side resolver for a Victor work's Dropbox base folder — so the client
 * (Victor especially) never needs to know or send the path. Given only a workId
 * it returns the stored dropbox_folder, creating the folder subtree on first use
 * and persisting it. This keeps the Artist/Project-revealing path server-only.
 *
 * Layout matches /api/dropbox/vendor-folder (projects layout):
 *   linked project → /Projects/{primaryArtist}/{project}/Victor
 *   standalone     → /Projects/Victor/{workTitle || vendor_work_<id8>}
 * with 01_From_Redbloods / 02_From_Victor / 03_Approved / Production inside.
 */

function sanitizeName(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
}
function primaryArtist(raw: string): string {
  return (raw || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
}

async function createFolder(token: string, path: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error_summary?: string };
    // "already exists" is fine — folder create is idempotent for our purposes.
    if (typeof body.error_summary === "string" && body.error_summary.includes("conflict")) return;
    throw new Error(`create_folder failed: ${JSON.stringify(body)}`);
  }
}

/**
 * Returns the work's Dropbox base folder, creating it if missing. workId only —
 * the path is derived server-side from the DB record, never trusted from a client.
 * Throws for a non-victor / missing work.
 */
export async function ensureVendorFolder(workId: string): Promise<string> {
  const work = await getVictorWorkById(workId); // server-side: full, unsanitized
  if (!work || work.vendorName !== "victor") throw new Error("work not found");
  if (work.dropboxFolder) return work.dropboxFolder;

  const hasProject = !!(work.projectId && (work.projectName ?? "").trim() && work.projectName !== "—");
  let basePath: string;
  if (hasProject) {
    const artistFolder = sanitizeName(primaryArtist(work.artist ?? ""));
    const projectFolder = sanitizeName(work.projectName ?? "");
    const projectBase = artistFolder
      ? `/Projects/${artistFolder}/${projectFolder}`
      : `/Projects/ללא אמן/${projectFolder}`;
    basePath = `${projectBase}/Victor`;
  } else {
    const titleFolder = sanitizeName(work.title ?? "") || `vendor_work_${workId.slice(0, 8)}`;
    basePath = `/Projects/Victor/${titleFolder}`;
  }

  const token = await getDropboxToken();
  await createFolder(token, basePath);
  await createFolder(token, `${basePath}/01_From_Redbloods`);
  await createFolder(token, `${basePath}/02_From_Victor`);
  await createFolder(token, `${basePath}/03_Approved`);
  await createFolder(token, `${basePath}/Production`);

  // Persist so subsequent uploads (and the owner's "Open in Dropbox") reuse it.
  await updateVictorWork(workId, { dropboxFolder: basePath });
  return basePath;
}
