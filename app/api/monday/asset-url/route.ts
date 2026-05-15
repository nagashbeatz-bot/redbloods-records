import { NextRequest, NextResponse } from "next/server";
import { mondayGQL } from "@/lib/monday";

/**
 * GET /api/monday/asset-url?assetId=xxx
 * Returns a fresh public_url for a Monday asset (signed S3, valid ~1h).
 * Called right before playback so the URL is always fresh.
 */
export async function GET(req: NextRequest) {
  const assetId = req.nextUrl.searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "assetId required" }, { status: 400 });
  }

  try {
    const data = await mondayGQL(
      `query ($ids: [ID!]!) { assets(ids: $ids) { id public_url } }`,
      { ids: [assetId] }
    );

    const asset = data?.assets?.[0];
    if (!asset?.public_url) {
      return NextResponse.json({ error: "asset not found" }, { status: 404 });
    }

    return NextResponse.json({ url: asset.public_url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאה";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
