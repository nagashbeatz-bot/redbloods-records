import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { queueVictorUploadNotice } from "@/lib/victor-upload-notify";

export const maxDuration = 300;

/**
 * POST /api/dropbox/vendor-upload
 * Uploads a file to a vendor-specific Dropbox subfolder.
 * Saves the file reference to vendor_project_work.files_sent.
 *
 * FormData: { file, workId, dropboxFolder, subFolder }
 *   workId        ג€” vendor_project_work.id
 *   dropboxFolder ג€” e.g. "Victor/Shalev - HaMida"
 *   subFolder     ג€” "01_From_Redbloods" | "03_Approved"
 */

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export async function POST(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const formData    = await req.formData();
    const file        = formData.get("file")         as File   | null;
    const workId      = formData.get("workId")       as string | null;
    const subFolder   = (formData.get("subFolder") as string | null) ?? "01_From_Redbloods";
    // Optional version tag (e.g. "V3") — one upload batch shares one label so the
    // UI can group a round together. Additive only: absent → behaves as before.
    const versionLabel = (formData.get("versionLabel") as string | null) || undefined;

    if (!file || !workId) {
      return NextResponse.json({ error: "׳—׳¡׳¨׳™׳ ׳₪׳¨׳׳˜׳¨׳™׳: file, workId, dropboxFolder" }, { status: 400 });
    }

    // Resolve the base folder SERVER-SIDE from the workId (creating it on first
    // use). The client never sends a path, so Victor can upload without ever
    // receiving the Artist/Project-revealing Dropbox folder.
    let baseFolder: string;
    try {
      const { ensureVendorFolder } = await import("@/lib/vendor-folder");
      baseFolder = await ensureVendorFolder(workId);
    } catch (e) {
      console.error("[vendor-upload] folder resolve failed:", e);
      return NextResponse.json({ error: "folder not ready" }, { status: 409 });
    }

    const sanitizedName = file.name.replace(/[<>:"/\\|?*]/g, "_");
    // subFolder is a fixed bucket name (Production / 03_Approved …) — strip
    // anything that isn't a plain name so it can't alter the path (no traversal).
    const cleanSubFolder = (subFolder ?? "").replace(/[^A-Za-z0-9_]/g, "");
    const cleanBase      = baseFolder.replace(/\/+$/, "");
    const dropboxPath    = cleanSubFolder
      ? `${cleanBase}/${cleanSubFolder}/${sanitizedName}`
      : `${cleanBase}/${sanitizedName}`;

    // Upload to Dropbox
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
      const errText = await uploadRes.text();
      let detail = errText;
      try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded   = (await uploadRes.json()) as { path_display: string; name: string };
    const finalPath  = uploaded.path_display;
    const streamUrl  = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

    // Get share link
    let shareUrl = "";
    try {
      const sRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: finalPath, settings: { requested_visibility: "public" } }),
      });
      if (sRes.ok) {
        const sd = await sRes.json() as { url: string };
        shareUrl = sd.url;
      } else {
        const sd = await sRes.json() as { error?: { shared_link_already_exists?: { metadata?: { url?: string } } } };
        shareUrl = sd?.error?.shared_link_already_exists?.metadata?.url ?? "";
      }
    } catch {}

    const newFile = { name: uploaded.name, url: streamUrl, dropboxPath: finalPath, dropboxShareUrl: shareUrl, ...(versionLabel ? { versionLabel } : {}) };

    // Update vendor_project_work.files_sent
    const { updateVictorWork, getVictorWorkForProject } = await import("@/lib/vendor-store");
    // Fetch current record to append
    const { supabase } = await import("@/lib/supabase");
    const { data: row } = await supabase
      .from("vendor_project_work")
      .select("files_sent, project_id, vendor_name, title")
      .eq("id", workId)
      .maybeSingle();

    // Ownership: only Victor's work rows may receive uploads here.
    if (!row || (row.vendor_name as string) !== "victor") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const currentFiles = (row?.files_sent as typeof newFile[]) ?? [];
    await updateVictorWork(workId, { filesSent: [...currentFiles, newFile] });

    // ── Owner push (batched, 3-min window) — ONLY when Victor uploaded, and only
    //    after the file is saved. Best-effort: never block/fail the upload. ──
    try {
      if ((await getAuthRole()) === "victor") {
        let projectName = (row.title as string | null) ?? "";
        if (!projectName && row.project_id) {
          const { data: proj } = await supabase
            .from("projects").select("name").eq("id", row.project_id as string).maybeSingle();
          projectName = (proj?.name as string) ?? "";
        }
        await queueVictorUploadNotice(workId, projectName || "פרויקט");
      }
    } catch (e) {
      console.error("[vendor-upload] notify queue failed (non-fatal):", e);
    }

    return NextResponse.json({ ok: true, file: newFile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "׳©׳’׳™׳׳× ׳©׳¨׳×";
    console.error("[dropbox/vendor-upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
