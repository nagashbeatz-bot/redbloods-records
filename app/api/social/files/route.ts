import { NextRequest, NextResponse } from "next/server";
import { listFiles, listFilesByCampaign, countFilesByContentItems } from "@/lib/social-files-store";

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
    return NextResponse.json({ error: "חסר contentItemId או campaignId" }, { status: 400 });
  } catch (e) {
    console.error("[social/files] GET error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
