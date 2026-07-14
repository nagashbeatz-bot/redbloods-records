/**
 * Phase 2A role resolution — by email, from env (no DB, no profiles table).
 *   OWNER_EMAILS = comma-separated owner emails (full access)
 *   VICTOR_EMAIL = Victor's supplier email (restricted)
 *   STEVEN_EMAIL = Steven's supplier email (restricted, sound engineer)
 *   SHALEV_EMAIL = Shalev Tasama's email (restricted — his artist portal only)
 * Any other authenticated email → "unknown" (treated as not authorized).
 * Safe to import from both proxy.ts and server route helpers (pure, no deps).
 */
export type UserRole = "owner" | "victor" | "steven" | "shalev" | "unknown";

function emailList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function roleForEmail(email: string | null | undefined): UserRole {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "unknown";
  if (emailList(process.env.OWNER_EMAILS).includes(e)) return "owner";
  const victor = (process.env.VICTOR_EMAIL ?? "").trim().toLowerCase();
  if (victor && e === victor) return "victor";
  const steven = (process.env.STEVEN_EMAIL ?? "").trim().toLowerCase();
  if (steven && e === steven) return "steven";
  const shalev = (process.env.SHALEV_EMAIL ?? "").trim().toLowerCase();
  if (shalev && e === shalev) return "shalev";
  return "unknown";
}

/** Victor's allowed surface — page + scoped APIs only. Everything else is denied.
 *  salary / work POST+DELETE / dropbox-delete are owner-only (also enforced per
 *  route); they are excluded here so the proxy blocks them too. */
export function isVictorAllowedPath(pathname: string): boolean {
  // Only the Victor profile page.
  if (pathname === "/team/victor" || pathname.startsWith("/team/victor/")) return true;

  // Salary is owner-only even though it lives under the victor API prefix.
  if (pathname.startsWith("/api/vendor/victor/salary")) return false;

  const apiAllow = [
    "/api/me",
    "/api/vendor/victor",          // GET stats/work, /projects, /work/[id] (method-guarded per route)
    "/api/dropbox/vendor-folder",
    "/api/dropbox/vendor-upload",
  ];
  return apiAllow.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Steven's allowed surface — his profile page + the sanitized supplier APIs only.
 *  Everything else (owner routes, other suppliers, Finance, admin) is denied by
 *  the proxy AND re-checked per route (requireStevenAccess + ownership). The raw
 *  /api/sound-engineer/* owner routes and /api/dropbox/* are intentionally NOT
 *  here — Steven streams his files only through /api/supplier/steven/stream. */
export function isStevenAllowedPath(pathname: string): boolean {
  if (pathname === "/team/steven" || pathname.startsWith("/team/steven/")) return true;
  const apiAllow = [
    "/api/me",
    "/api/supplier/steven",        // list + work/[id]/* + versions/comments/materials/stream (method+ownership guarded per route)
  ];
  return apiAllow.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Shalev's allowed surface — ONLY his artist portal (served at /red-artists) and
 *  the Shalev-scoped /api/red-artists/* endpoints (each hardcoded server-side to
 *  his own folders/name). He never reaches /label/artists/[id] (the dual-purpose
 *  route that would render other artists' owner view) — the proxy redirects him
 *  to /red-artists. The raw /api/dropbox/stream (arbitrary path) and
 *  /api/label/releases (all artists) are intentionally NOT here; the portal uses
 *  the scoped /api/red-artists/stream instead. */
export function isShalevAllowedPath(pathname: string): boolean {
  if (pathname === "/red-artists" || pathname.startsWith("/red-artists/")) return true;
  const apiAllow = [
    "/api/me",
    "/api/red-artists",            // sketches CRUD/reorder/duration, shalev-summary, performance-files, upload, press-kit-link, profile-image, stream (all Shalev-scoped per route)
  ];
  return apiAllow.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
