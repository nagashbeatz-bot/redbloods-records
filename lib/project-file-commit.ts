import "server-only";
import { supabase } from "@/lib/supabase";

/**
 * Extracted from app/api/dropbox/upload/route.ts's POST handler (steps 2-4:
 * share link, share token, persist to projects.files) so any other caller that
 * lands bytes at a Dropbox path (e.g. auto-duplicating a Steven full-mix
 * upload via files/copy_v2 — lib/mix-version-project-copy.ts) gets the EXACT
 * same destination shape/behaviour as a manual upload — same share link
 * creation, same /share/TOKEN page, same projects.files entry, same player
 * appearance. The manual route's step 1 (uploading raw bytes) is unchanged
 * and stays in the route; only the shared tail moved here.
 */

async function createDropboxShareLink(token: string, path: string): Promise<string> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, settings: { requested_visibility: "public" } }),
    }
  );

  if (res.ok) {
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  const err = (await res.json()) as Record<string, unknown>;
  // If link already exists, Dropbox returns it inside the error
  const errObj = err.error as Record<string, unknown> | undefined;
  if (errObj?.[".tag"] === "shared_link_already_exists") {
    const inner = errObj.shared_link_already_exists as Record<string, unknown> | undefined;
    const url = (inner?.metadata as Record<string, string> | undefined)?.url;
    if (url) return url;
  }
  throw new Error((err.error_summary as string) ?? "Failed to create Dropbox share link");
}

export interface CommitFileOpts {
  trackId?: string;
  versionLabel?: string;
  durationSeconds?: number;
  /** Marks a file that was auto-duplicated from a mix_versions row (not a
   *  manual upload) — used to prevent duplicating the same version twice. */
  sourceMixVersionId?: string;
}

export interface CommitFileResult {
  shareUrl: string;
  shareLinkError: string;
  fileUrl: string;
}

/** Given bytes already sitting at `finalPath` in the project's Dropbox folder,
 *  create the public share link + /share token + projects.files entry — the
 *  exact same tail every project-file upload (manual or auto-duplicated) goes
 *  through, so the file appears in the player identically either way. */
export async function commitFileToProject(
  token: string,
  projectId: string,
  finalPath: string,
  displayName: string,
  opts: CommitFileOpts = {},
): Promise<CommitFileResult> {
  const fileUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

  let shareUrl = "";
  let shareLinkError = "";
  try {
    shareUrl = await createDropboxShareLink(token, finalPath);
  } catch (e) {
    shareLinkError = e instanceof Error ? e.message : "שגיאה ביצירת לינק";
  }

  try {
    const shareToken = crypto.randomUUID().replace(/-/g, "");
    await supabase.from("settings").insert({
      key: `share_token_${shareToken}`,
      value: { dropboxPath: finalPath, fileName: displayName, createdAt: new Date().toISOString() },
    });
  } catch { /* non-fatal */ }

  const { addFileToProject } = await import("@/lib/projects-store");
  await addFileToProject(projectId, {
    name: displayName,
    url: fileUrl,
    dropboxPath: finalPath,
    dropboxShareUrl: shareUrl,
    ...(opts.trackId ? { trackId: opts.trackId } : {}),
    ...(opts.versionLabel ? { versionLabel: opts.versionLabel } : {}),
    ...(opts.durationSeconds ? { durationSeconds: opts.durationSeconds } : {}),
    ...(opts.sourceMixVersionId ? { sourceMixVersionId: opts.sourceMixVersionId } : {}),
  });

  return { shareUrl, shareLinkError, fileUrl };
}
