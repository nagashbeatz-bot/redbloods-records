/**
 * Phase 2A role resolution — by email, from env (no DB, no profiles table).
 *   OWNER_EMAILS     = comma-separated owner emails (full access)
 *   VICTOR_EMAIL     = Victor's supplier email (restricted)
 *   STEVEN_EMAIL     = Steven's supplier email (restricted, sound engineer)
 *   SHALEV_EMAIL     = Shalev Tasama's email (restricted — his artist portal only)
 *   CLEANTONE_EMAIL  = DJ CLEANTONE's (רועי איוב) email (restricted — his 2-page portal only)
 * Any other authenticated email → "unknown" (treated as not authorized).
 * Safe to import from both proxy.ts and server route helpers (pure, no deps).
 */
export type UserRole = "owner" | "victor" | "steven" | "shalev" | "cleantone" | "avi" | "unknown";

/** Avi Molla's label_artists.id — his portal is served at /label/artists/[this].
 *  Not secret (appears in the URL); kept here so the allowlist can scope him to
 *  his OWN artist page only (no IDOR to other artists). */
export const AVI_ARTIST_ID = "b3499c72-069d-46c9-9c31-52b1db27c51f";

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
  const cleantone = (process.env.CLEANTONE_EMAIL ?? "").trim().toLowerCase();
  if (cleantone && e === cleantone) return "cleantone";
  const avi = (process.env.AVI_EMAIL ?? "").trim().toLowerCase();
  if (avi && e === avi) return "avi";
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

  // The manual "send work to Victor" push is owner-only, even though it lives
  // under the victor API prefix (requireOwner enforces it in-route too).
  if (pathname.startsWith("/api/vendor/victor/notify-work")) return false;

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
    "/api/red-artists",            // sketches CRUD/reorder/duration, shalev-summary, performance-files, upload, press-kit-link, profile-image, stream, balance (all Shalev-scoped per route)
    "/api/beats",                  // free-beats pool: GET list + GET [id]/stream only (read/listen); POST/PATCH/DELETE stay requireOwner per route
  ];
  return apiAllow.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** DJ CLEANTONE's allowed surface — ONLY his 2-page portal (/dj-cleantone) and
 *  the scoped /api/red-artists/cleantone* endpoints (cleantone-summary +
 *  cleantone/shows/[id]/confirm). He never reaches /red-artists (Shalev's
 *  portal), /label/artists/[id] (owner preview of other artists), or any
 *  other /api/red-artists/* route (those stay Shalev/owner-scoped). */
export function isCleantoneAllowedPath(pathname: string): boolean {
  if (pathname === "/dj-cleantone" || pathname.startsWith("/dj-cleantone/")) return true;
  const apiAllow = [
    "/api/me",
    "/api/red-artists/cleantone-summary",
    "/api/red-artists/cleantone",  // /api/red-artists/cleantone/shows/[id]/confirm
  ];
  return apiAllow.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Avi Molla's allowed surface — ONLY his own artist page (/label/artists/[AVI_ARTIST_ID])
 *  and the READ endpoints behind his 3 tabs (בית / ההופעות שלי / המוזיקה שלי),
 *  scoped to HIS id. Exact-match only: sketch sub-paths (reorder, [id], version),
 *  upload, balance, recoup, beats, performance-files, press-kit and every OTHER
 *  artist's id are all denied. Writes on the allowed routes (next-work/availability/
 *  profile-image/sketches POST) stay owner-only per route, so this allowlist never
 *  lets Avi mutate anything. The shows tab reads from /summary (money stripped for
 *  role "avi" in that route). */
export function isAviAllowedPath(pathname: string): boolean {
  if (pathname === "/api/me") return true;
  if (pathname === `/label/artists/${AVI_ARTIST_ID}`) return true;
  const base = `/api/label/artists/${AVI_ARTIST_ID}`;
  const allowed = [
    `${base}/summary`,
    `${base}/next-work`,
    `${base}/next-release`,
    `${base}/availability`,
    `${base}/weekly`,
    `${base}/profile-image`,
    `${base}/sketches`,
    `${base}/stream`,
    // The ONE self-write Avi may perform: register HIS OWN Web Push device
    // (push_subscriptions row bound to his user id). The route itself gates to
    // his id / owner and never touches artist data — no other mutation opens up.
    `${base}/push-subscribe`,
  ];
  return allowed.includes(pathname);
}
