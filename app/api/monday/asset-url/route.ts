import { NextRequest, NextResponse } from "next/server";

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

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "MONDAY_API_TOKEN not configured" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({
        query: `query ($ids: [ID!]!) { assets(ids: $ids) { id public_url } }`,
        variables: { ids: [assetId] },
      }),
    });

    const json = await res.json();
    const url: string | undefined = json?.data?.assets?.[0]?.public_url;

    if (!url) {
      return NextResponse.json({ error: "asset not found" }, { status: 404 });
    }

    return NextResponse.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאה";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
