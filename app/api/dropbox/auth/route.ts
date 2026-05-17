import { NextRequest, NextResponse } from "next/server";

/** GET /api/dropbox/auth — returns the Dropbox OAuth URL */
export async function GET(req: NextRequest) {
  if (!process.env.DROPBOX_APP_KEY || !process.env.DROPBOX_APP_SECRET) {
    return NextResponse.json(
      { error: "DROPBOX_APP_KEY / DROPBOX_APP_SECRET חסרים ב-.env.local" },
      { status: 500 }
    );
  }

  const host   = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto  = req.headers.get("x-forwarded-proto")?.split(",")[0] || "http";
  const redirectUri = `${proto}://${host}/api/dropbox/callback`;

  const { getDropboxAuthUrl } = await import("@/lib/dropbox-token");
  const url = getDropboxAuthUrl(redirectUri);
  return NextResponse.json({ url });
}
