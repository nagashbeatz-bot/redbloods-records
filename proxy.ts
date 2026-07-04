import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  "/api/maintenance/status", // boolean lock state only — used by the owner Sidebar
];

// Service-role client (read-only use here) for the global maintenance flag. The
// auth read above uses the ANON key + user session; the flag lives in the
// RLS-locked settings table, so it needs the service key. Memoized at module
// scope so we don't rebuild it per request.
let _svc: SupabaseClient | null = null;
function svcClient(): SupabaseClient | null {
  if (_svc) return _svc;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  _svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _svc;
}

// Global maintenance flag. 15s TTL; owner requests never reach this. Two read
// paths for runtime robustness: (1) direct service-role read of settings;
// (2) fallback self-fetch of the public boolean status endpoint (no
// AbortSignal — not every middleware runtime implements AbortSignal.timeout).
// Fail-open + log only if BOTH fail, so a glitch can never lock everyone out.
let maintCache: { on: boolean; ts: number } | null = null;
async function isMaintenanceOn(request: NextRequest): Promise<boolean> {
  const now = Date.now();
  if (maintCache && now - maintCache.ts < 15000) return maintCache.on;

  const sb = svcClient();
  if (sb) {
    try {
      const { data, error } = await sb.from("settings").select("value").eq("key", "maintenance_mode").maybeSingle();
      if (!error) {
        const on = (data?.value as { enabled?: boolean } | null)?.enabled === true;
        maintCache = { on, ts: now };
        return on;
      }
      console.error("[proxy] maintenance direct read error:", error.message);
    } catch (e) {
      console.error("[proxy] maintenance direct read failed:", e);
    }
  } else {
    console.error("[proxy] maintenance: SUPABASE_URL/SECRET_KEY unavailable — trying status endpoint");
  }

  try {
    const res = await fetch(new URL("/api/maintenance/status", request.url), { headers: { "cache-control": "no-store" } });
    if (res.ok) {
      const on = (await res.json())?.enabled === true;
      maintCache = { on, ts: now };
      return on;
    }
    console.error("[proxy] maintenance status endpoint non-ok:", res.status);
  } catch (e) {
    console.error("[proxy] maintenance status fetch failed (fail-open):", e);
  }
  return false; // fail-open
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_BYPASS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // The maintenance screen is always reachable (static, no data) so blocked
  // users actually land on it.
  if (pathname === "/maintenance") return NextResponse.next();

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

  // ── Maintenance lock ──────────────────────────────────────────────────────
  // Owner ALWAYS bypasses (role is resolved server-side from the session, never
  // the client). Everyone else — signed in or not — is held on the maintenance
  // screen (pages) / a clean 503 (api). /login stays open so the owner can sign
  // in; /maintenance and PUBLIC_BYPASS were already allowed above.
  if (role !== "owner" && pathname !== "/login" && (await isMaintenanceOn(request))) {
    if (isApi) return NextResponse.json({ maintenance: true }, { status: 503 });
    return NextResponse.redirect(new URL("/maintenance", request.url));
  }

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
