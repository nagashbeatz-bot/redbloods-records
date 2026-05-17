import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/dropbox/stream?path=/projectId/filename.mp3
 *
 * Fetches a fresh 4-hour temporary link from Dropbox and redirects to it.
 * Used as the audio src so the player always gets a playable direct URL.
 */
export async function GET(req: NextRequest) {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "DROPBOX_ACCESS_TOKEN לא מוגדר" },
      { status: 500 }
    );
  }

  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  }

  const res = await fetch(
    "https://api.dropboxapi.com/2/files/get_temporary_link",
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[dropbox/stream]", err);
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }

  const data = (await res.json()) as { link: string };
  // 302 redirect → browser/audio-element follows to Dropbox CDN directly
  return NextResponse.redirect(data.link, 302);
}
