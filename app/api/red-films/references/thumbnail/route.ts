/**
 * GET /api/red-films/references/thumbnail?path=...
 * Proxies a Dropbox thumbnail (w640h480 JPEG) for fast grid display.
 * Full-resolution image is loaded only in the lightbox via dropbox_url.
 */
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  }

  let token: string;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    token = await getDropboxToken();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Dropbox לא מחובר" },
      { status: 500 }
    );
  }

  const arg = JSON.stringify({
    path,
    format: { ".tag": "jpeg" },
    size:   { ".tag": "w640h480" },
    mode:   { ".tag": "fitone_way" },
  }).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );

  const res = await fetch(
    "https://content.dropboxapi.com/2/files/get_thumbnail",
    {
      method:  "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "Dropbox-API-Arg": arg,
      },
    }
  );

  if (!res.ok) {
    // Thumbnail unavailable (e.g. unsupported format) — tell client to fall back
    return new NextResponse(null, { status: 404 });
  }

  const contentType = res.headers.get("Content-Type") ?? "image/jpeg";
  const buffer = await res.arrayBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":  contentType,
      // Cache thumbnail in browser for 1 hour — reduces repeat fetches
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
