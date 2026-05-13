import { NextRequest, NextResponse } from "next/server";

/** GET /api/calendar/auth — returns the Google OAuth URL */
export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET חסרים ב-.env.local" },
      { status: 500 }
    );
  }

  // Derive redirect URI from the actual request origin — works on any domain automatically
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/calendar/callback`;

  const { getAuthUrl } = await import("@/lib/google-calendar");
  const url = getAuthUrl(redirectUri);
  return NextResponse.json({ url });
}
