import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/share/",        // client share pages
  "/api/auth/",     // login / logout API
  "/login",         // login page
  "/_next/",        // Next.js assets
  "/favicon",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check auth cookie
  const auth = req.cookies.get("rb_auth")?.value;
  const expected = process.env.APP_PASSWORD;

  if (!expected || auth !== expected) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
