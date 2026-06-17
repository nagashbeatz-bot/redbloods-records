import { NextRequest, NextResponse } from "next/server";
import { createSocialFile } from "@/lib/social-files-store";

export const maxDuration = 300;

const MAX_SIZE = 500 * 1024 * 1024; // 500MB

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const contentItemId = formData.get("contentItemId") as string | null;
    const campaignId = formData.get("campaignId") as string | null;
    const projectId = (formData.get("projectId") as string | null) || null;

    if (!file) return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });
    if (!contentItemId || !campaignId) {
      return NextResponse.json({ error: "חסרים contentItemId / campaignId" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 500MB)" }, { status: 413 });
    }

    const sanitizedName = file.name.replace(/[<>:"/\\|?*]/g, "_");
    const basePath = projectId
      ? `/${projectId}/Social/${contentItemId}`
      : `/Social/${campaignId}/${contentItemId}`;
    const dropboxPath = `${basePath}/${sanitizedName}`;

    // Upload to Dropbox
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({
          path: dropboxPath,
          mode: "add",
          autorename: true,
          mute: false,
        }),
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      let detail = errText;
      try { detail = (JSON.parse(errText) as { error_summary?: string })?.error_summary ?? errText; } catch {}
      console.error("[social/upload] Dropbox upload error:", detail);
      return NextResponse.json({ error: `שגיאת Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded = (await uploadRes.json()) as { path_display: string; name: string; id: string };
    const finalPath = uploaded.path_display;

    // Get share link
    let shareUrl = "";
    try {
      const sRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: finalPath, settings: { requested_visibility: "public" } }),
      });
      if (sRes.ok) {
        shareUrl = ((await sRes.json()) as { url: string }).url;
      } else {
        const sd = (await sRes.json()) as {
          error?: { shared_link_already_exists?: { metadata?: { url?: string } } };
        };
        shareUrl = sd?.error?.shared_link_already_exists?.metadata?.url ?? "";
      }
    } catch {}

    // Save to DB
    const fileRecord = await createSocialFile({
      content_item_id: contentItemId,
      campaign_id: campaignId,
      project_id: projectId,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      file_size: file.size,
      dropbox_path: finalPath,
      dropbox_file_id: uploaded.id ?? "",
      dropbox_share_link: shareUrl,
      uploaded_by: "",
    });

    return NextResponse.json({ ok: true, file: fileRecord });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[social/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
