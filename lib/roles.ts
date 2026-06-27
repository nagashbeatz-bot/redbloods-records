/**
 * Phase 2A role resolution — by email, from env (no DB, no profiles table).
 *   OWNER_EMAILS = comma-separated owner emails (full access)
 *   VICTOR_EMAIL = Victor's supplier email (restricted)
 * Any other authenticated email → "unknown" (treated as not authorized).
 * Safe to import from both proxy.ts and server route helpers (pure, no deps).
 */
export type UserRole = "owner" | "victor" | "unknown";

function emailList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function roleForEmail(email: string | null | undefined): UserRole {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "unknown";
  if (emailList(process.env.OWNER_EMAILS).includes(e)) return "owner";
  const victor = (process.env.VICTOR_EMAIL ?? "").trim().toLowerCase();
  if (victor && e === victor) return "victor";
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
