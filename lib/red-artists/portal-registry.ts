/**
 * Pure name↔slug registry for portal artists — no DB, no "server-only", safe
 * to import from client components. lib/red-artists/portal-config.ts wraps
 * this with the server-only DB lookups (artistId → row → config); this file
 * holds only the static mapping so client code (e.g. the label-management
 * avatar) can derive an artist's isolated Dropbox slug without a server round
 * trip. `slug` drives Dropbox folder names and settings keys, so it must
 * NEVER change once an artist has real data.
 */
export const PORTAL_ARTISTS: Record<string, { slug: string }> = {
  "שליו טסמה": { slug: "shalev-tasama" },
  "אבי מולה":   { slug: "avi-molla" },
  "DJ CLEANTONE": { slug: "dj-cleantone" },
};

export const SHALEV_NAME = "שליו טסמה";
export const SHALEV_SLUG = "shalev-tasama";

/** True iff this exact label_artists.name has a registered portal. */
export function isPortalArtistName(name: string | null | undefined): boolean {
  return !!name && Object.prototype.hasOwnProperty.call(PORTAL_ARTISTS, name);
}

/** The artist's isolated Dropbox slug, or null if they have no portal. */
export function slugForPortalArtistName(name: string | null | undefined): string | null {
  if (!name) return null;
  return PORTAL_ARTISTS[name]?.slug ?? null;
}
