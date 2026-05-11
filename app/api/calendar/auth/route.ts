import { NextResponse } from "next/server";

/** GET /api/calendar/auth — returns the Google OAuth URL */
export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET חסרים ב-.env.local" },
      { status: 500 }
    );
  }

  const { getAuthUrl } = await import("@/lib/google-calendar");
  const url = getAuthUrl();
  return NextResponse.json({ url });
}
