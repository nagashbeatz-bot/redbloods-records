import { NextRequest, NextResponse } from "next/server";
import { projectBaseFolder, sanitizeFolder } from "@/lib/project-paths";

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

    if (!file || !projectId || !newName) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }

    // Build an organized folder path from the project. New uploads only —
    // existing files keep their stored dropboxPath. The file NAME is unchanged.
    const { getProject } = await import("@/lib/projects-store");
    const project       = await getProject(projectId);
    let folderPath = projectBaseFolder(project?.artist ?? "", project?.name ?? "", projectId);

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

    // ── 2. Build URLs ──────────────────────────────────────────────────────────
    // Internal stream URL (for the in-app player)
    const fileUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

    // ── 2b. Create Dropbox permanent share link ──────────────────────────────
    let shareUrl = "";
    let shareLinkError = "";
    try {
      shareUrl = await createDropboxShareLink(token, finalPath);
    } catch (e) {
      shareLinkError = e instanceof Error ? e.message : "שגיאה ביצירת לינק";
    }

    // ── 3. Create a share token → public player page ──────────────────────────
    // Generate a random token, store it in Supabase settings, return a /share/TOKEN URL.
    // The /share page shows only a minimal audio player — no app access possible.
    try {
      const shareToken = crypto.randomUUID().replace(/-/g, "");
      const { supabase } = await import("@/lib/supabase");
      await supabase.from("settings").insert({
        key:   `share_token_${shareToken}`,
        value: { dropboxPath: finalPath, fileName: newName, createdAt: new Date().toISOString() },
      });
    } catch { /* non-fatal */ }

    // ── 4. Persist to Supabase ────────────────────────────────────────────────
    const { addFileToProject } = await import("@/lib/projects-store");
    await addFileToProject(projectId, {
      name:            newName,
      url:             fileUrl,
      dropboxPath:     finalPath,
      dropboxShareUrl: shareUrl,
      ...(trackId      ? { trackId }      : {}),
      ...(versionLabel ? { versionLabel } : {}),
    });

    return NextResponse.json({ ok: true, shareUrl, shareLinkError, file: { name: newName, url: fileUrl, dropboxPath: finalPath, dropboxShareUrl: shareUrl } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
