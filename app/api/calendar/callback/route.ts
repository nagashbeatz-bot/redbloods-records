import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/calendar/callback?code=...
 * Google redirects here after user approves OAuth.
 * Exchanges the code for tokens and saves them.
 */
export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  // Resolve public origin (works behind Railway / any reverse proxy)
  const host   = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto  = req.headers.get("x-forwarded-proto")?.split(",")[0] || "http";
  const origin = `${proto}://${host}`;

  if (error) {
    return NextResponse.redirect(
      `${origin}/setup/calendar?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/setup/calendar?error=no_code`
    );
  }

  try {
    const { getOAuthClient, saveToken } = await import("@/lib/google-calendar");
    const redirectUri = `${origin}/api/calendar/callback`;
    const oauth2 = getOAuthClient(redirectUri);
    const { tokens } = await oauth2.getToken(code);
    await saveToken(tokens);
    return NextResponse.redirect(`${origin}/setup/calendar?connected=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.redirect(
      `${origin}/setup/calendar?error=${encodeURIComponent(msg)}`
    );
  }
}
