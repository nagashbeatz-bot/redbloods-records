import { NextRequest, NextResponse } from "next/server";
import { listFiles, listFilesByCampaign, countFilesByContentItems, getFile, deleteSocialFile } from "@/lib/social-files-store";
import { getDropboxToken } from "@/lib/dropbox-token";

export async function GET(req: NextRequest) {
  const contentItemId = req.nextUrl.searchParams.get("contentItemId");
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  const counts = req.nextUrl.searchParams.get("counts");

  try {
    if (contentItemId) {
      const files = await listFiles(contentItemId);
      return NextResponse.json({ files });
    }
    if (campaignId && counts === "1") {
      // Return counts per content_item_id for a campaign
      const allFiles = await listFilesByCampaign(campaignId);
      const result: Record<string, number> = {};
      for (const f of allFiles) {
        result[f.content_item_id] = (result[f.content_item_id] ?? 0) + 1;
      }
      return NextResponse.json({ counts: result });
    }
    if (campaignId) {
      // Return all files for a campaign (for thumbnail display)
      const allFiles = await listFilesByCampaign(campaignId);
      return NextResponse.json({ files: allFiles });
    }
    return NextResponse.json({ error: "חסר contentItemId או campaignId" }, { status: 400 });
  } catch (e) {
    console.error("[social/files] GET error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("id");
  if (!fileId) return NextResponse.json({ error: "חסר id" }, { status: 400 });
  try {
    const file = await getFile(fileId);
    if (file?.dropbox_path) {
      try {
        const token = await getDropboxToken();
        await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.dropbox_path }),
        });
      } catch {
        // Dropbox unavailable — continue with DB deletion
      }
    }
    await deleteSocialFile(fileId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[social/files] DELETE error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
