import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Paths that bypass the auth gate entirely:
//  • OAuth callbacks — external redirect from Google/Dropbox carrying a one-time
//    code; must be reachable without a session.
//  • cron endpoints — invoked by an external scheduler with no cookies; already
//    guarded by ?secret=CRON_SECRET.
const PUBLIC_BYPASS = [
  "/api/calendar/callback",
  "/api/dropbox/callback",
  "/api/agent/check",
  "/api/agent/snapshot",
  "/api/sessions/calendar-pull",
  "/api/push/cron",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_BYPASS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Read the session from cookies (anon key — never the service key).
  let response = NextResponse.next({ request });
  let user = null;
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Misconfigured env or auth server unreachable → fail closed (treat as anon).
    user = null;
  }

  // The login page is reachable while signed out; a signed-in user is bounced home.
  if (pathname === "/login") {
    if (user) return NextResponse.redirect(new URL("/dashboard", request.url));
    return response;
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run on everything EXCEPT Next internals and static assets / PWA files,
  // so static delivery, fonts, images, the service worker and manifest are
  // never gated (which would break Push and asset loading).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|css|js|map)$).*)",
  ],
};
