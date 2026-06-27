import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { roleForEmail, isVictorAllowedPath } from "@/lib/roles";

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
  let email: string | null = null;
  let signedIn = false;
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
    if (data.user) { signedIn = true; email = data.user.email ?? null; }
  } catch {
    signedIn = false;
  }

  const role = signedIn ? roleForEmail(email) : null;
  const isApi = pathname.startsWith("/api/");
  const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });
  const toLogin = () => {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  };

  // Login page: signed-in users go to their home; anon/unknown see the form.
  if (pathname === "/login") {
    if (role === "owner") return NextResponse.redirect(new URL("/dashboard", request.url));
    if (role === "victor") return NextResponse.redirect(new URL("/team/victor", request.url));
    return response;
  }

  // Not signed in → Phase 1 gate.
  if (!signedIn) {
    if (isApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return toLogin();
  }

  // Owner → full access (unchanged).
  if (role === "owner") return response;

  // Victor → restricted to his page + scoped APIs.
  if (role === "victor") {
    if (isVictorAllowedPath(pathname)) return response;
    if (isApi) return forbidden();
    return NextResponse.redirect(new URL("/team/victor", request.url));
  }

  // Signed in but email not recognized → locked out.
  if (isApi) return forbidden();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|css|js|map)$).*)",
  ],
};
