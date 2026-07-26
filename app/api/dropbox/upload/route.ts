import { NextRequest, NextResponse } from "next/server";
import { projectBaseFolder, sanitizeFolder } from "@/lib/project-paths";
import { commitFileToProject } from "@/lib/project-file-commit";

// Allow up to 5 minutes for large audio file uploads (WAV/FLAC can be 200MB+)
export const maxDuration = 300;

/**
 * Serialize an object to JSON where every non-ASCII character is escaped as \uXXXX.
 * Required for the Dropbox-API-Arg header — HTTP headers must be pure ASCII.
 */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const formData     = await req.formData();
    const file         = formData.get("file")         as File   | null;
    const projectId    = formData.get("projectId")    as string | null;
    const newName      = formData.get("newName")      as string | null;
    const trackId      = formData.get("trackId")      as string | null;
    const versionLabel = formData.get("versionLabel") as string | null;
    const subfolder    = formData.get("subfolder")    as string | null;
    // Optional audio length (metadata only) — computed client-side. Accept only a
    // finite positive number; never trust it beyond storing as metadata.
    const durationRaw    = formData.get("durationSeconds") as string | null;
    const durationParsed = durationRaw != null ? Number(durationRaw) : NaN;
    const durationSeconds = Number.isFinite(durationParsed) && durationParsed > 0 ? Math.round(durationParsed) : undefined;

    if (!file || !projectId || !newName) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }

    // Build an organized folder path from the project. New uploads only —
    // existing files keep their stored dropboxPath. The file NAME is unchanged.
    const { getProject } = await import("@/lib/projects-store");
    const project       = await getProject(projectId);
    // Frozen folder (projects.dropbox_folder) wins → renaming never moves uploads.
    let folderPath = projectBaseFolder(project?.artist ?? "", project?.name ?? "", projectId, project?.dropboxFolder);

    // Optional subfolder (e.g. "Delivery" or nested "Delivery/ערוצים") — new
    // uploads only; existing files are untouched. Each path segment is sanitized
    // separately so a "/" inside the subfolder is preserved as nesting (not
    // stripped). When absent, behavior is exactly as before.
    if (subfolder) {
      const sub = subfolder.split("/").map(sanitizeFolder).filter(Boolean).join("/");
      if (sub) folderPath = `${folderPath}/${sub}`;
    }

    // newName is already built/sanitized client-side — do NOT alter it.
    const dropboxPath = `${folderPath}/${newName}`;

    // ── 1. Upload to Dropbox ──────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadRes = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization:     `Bearer ${token}`,
          "Content-Type":    "application/octet-stream",
          "Dropbox-API-Arg": dropboxArg({
            path:       dropboxPath,
            mode:       "add",
            autorename: true,
            mute:       false,
          }),
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[dropbox/upload] upload failed:", errText);
      let detail = errText;
      try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded = (await uploadRes.json()) as { path_display: string; name: string };
    const finalPath = uploaded.path_display;

    // ── 2-4. Share link + share token + projects.files — shared with the
    // auto-duplication path (lib/mix-version-project-copy.ts) so a manual
    // upload and an auto-copied file end up identical in every way but how
    // the bytes arrived at `finalPath`. ──────────────────────────────────────
    const { shareUrl, shareLinkError, fileUrl } = await commitFileToProject(token, projectId, finalPath, newName, {
      ...(trackId         ? { trackId }         : {}),
      ...(versionLabel    ? { versionLabel }    : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
    });

    return NextResponse.json({ ok: true, shareUrl, shareLinkError, file: { name: newName, url: fileUrl, dropboxPath: finalPath, dropboxShareUrl: shareUrl } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
