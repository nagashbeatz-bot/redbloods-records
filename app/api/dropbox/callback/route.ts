import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/dropbox/callback?code=...
 * Dropbox redirects here after the user approves OAuth.
 * Exchanges the code for access + refresh tokens and stores them in Supabase.
 */
export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  const host   = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto  = req.headers.get("x-forwarded-proto")?.split(",")[0] || "http";
  const origin = `${proto}://${host}`;

  if (error) {
    return NextResponse.redirect(
      `${origin}/setup/dropbox?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/setup/dropbox?error=no_code`);
  }

  try {
    const { exchangeCodeForTokens } = await import("@/lib/dropbox-token");
    const redirectUri = `${origin}/api/dropbox/callback`;
    await exchangeCodeForTokens(code, redirectUri);
    return NextResponse.redirect(`${origin}/setup/dropbox?connected=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.redirect(
      `${origin}/setup/dropbox?error=${encodeURIComponent(msg)}`
    );
  }
}
