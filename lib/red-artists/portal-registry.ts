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
  "נגש ביטס":     { slug: "nagash-beats" },
};

export const SHALEV_NAME = "שליו טסמה";
export const SHALEV_SLUG = "shalev-tasama";
// The other registered portal names, so callers stop re-declaring them locally.
export const AVI_NAME = "אבי מולה";
export const CLEANTONE_NAME = "DJ CLEANTONE";
export const NAGASH_NAME = "נגש ביטס";

/** True iff this exact label_artists.name has a registered portal. */
export function isPortalArtistName(name: string | null | undefined): boolean {
  return !!name && Object.prototype.hasOwnProperty.call(PORTAL_ARTISTS, name);
}

/** Every registered portal slug — the only values a beat assignment may carry. */
export const PORTAL_SLUGS: string[] = Object.values(PORTAL_ARTISTS).map((a) => a.slug);

/** True iff `slug` is a registered portal slug. Guards the ?artist= parameter so
 *  no caller can invent a scope that isn't a real artist. */
export function isPortalSlug(slug: string | null | undefined): boolean {
  return !!slug && PORTAL_SLUGS.includes(slug);
}

/** The artist's isolated Dropbox slug, or null if they have no portal. */
export function slugForPortalArtistName(name: string | null | undefined): string | null {
  if (!name) return null;
  return PORTAL_ARTISTS[name]?.slug ?? null;
}

/**
 * The ONLY artists for whom the "Projects upload → link into their המוזיקה שלי
 * by reference" feature is enabled. Deliberately an explicit name list, not a
 * capability derived from PORTAL_ARTISTS — DJ CLEANTONE (and any future portal
 * artist) must stay OUT until someone adds them here on purpose.
 */
export const LINK_ENABLED_NAMES: readonly string[] = [AVI_NAME, SHALEV_NAME, NAGASH_NAME];

/** True iff this exact label_artists.name may use the Projects→sketch link flow. */
export function isLinkEnabledArtistName(name: string | null | undefined): boolean {
  return !!name && LINK_ENABLED_NAMES.includes(name);
}

/**
 * The artists whose owner-triggered "שלח התראה" (and the automatic notify that
 * follows a Projects link) can actually reach the ARTIST. Mirrors NOTIFY_TARGETS in
 * app/api/label/artists/[id]/sketches/[sketchId]/notify/route.ts, which holds the
 * real per-artist push audience and answers 403 for anyone else.
 *
 * Kept separate from LINK_ENABLED_NAMES on purpose: linking a file into a library
 * needs no recipient, notifying does. נגש ביטס has no login/device, so he is
 * link-enabled but NOT notify-enabled — the UI must neither offer nor fire a
 * notification for him. Add a name here only together with its NOTIFY_TARGETS entry.
 */
export const NOTIFY_ENABLED_NAMES: readonly string[] = [AVI_NAME, SHALEV_NAME];

/** True iff a notification about this artist's library has a real recipient. */
export function isNotifyEnabledArtistName(name: string | null | undefined): boolean {
  return !!name && NOTIFY_ENABLED_NAMES.includes(name);
}

/** Short Hebrew first name for UI copy ("אבי" / "שליו"). Falls back to the full
 *  registered name, so an unmapped artist never renders an empty label. */
const SHORT_NAMES: Record<string, string> = {
  [AVI_NAME]: "אבי",
  [SHALEV_NAME]: "שליו",
};
export function shortArtistName(name: string | null | undefined): string {
  if (!name) return "";
  return SHORT_NAMES[name] ?? name;
}
