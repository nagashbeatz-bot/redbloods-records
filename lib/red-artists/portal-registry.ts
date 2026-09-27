/**
 * Pure name↔slug registry for portal artists — no DB, no "server-only", safe
 * to import from client components. lib/red-artists/portal-config.ts wraps
 * this with the server-only DB lookups (artistId → row → config); this file
 * holds only the static mapping so client code (e.g. the label-management
 * avatar) can derive an artist's isolated Dropbox slug without a server round
 * trip. `slug` drives Dropbox folder names and settings keys, so it must
 * NEVER change once an artist has real data.
 */
import { AVI_ARTIST_ID } from "../roles";

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

/** The portal names that belong to LABEL ARTISTS. DJ CLEANTONE's portal is a TEAM portal (the label's DJ, not a label
 *  artist — Owner decision 2026-09-27): he stays in PORTAL_ARTISTS only for his portal's slug (avatar / stream). */
export const LABEL_PORTAL_NAMES: readonly string[] = Object.keys(PORTAL_ARTISTS).filter((n) => n !== CLEANTONE_NAME);

/** Shalev Tasama's label_artists.id (stable identity; the name is a display snapshot). Not secret. */
export const SHALEV_ARTIST_ID = "8806fe5e-1238-4228-8078-b3db3ccc9b46";

/**
 * B4 identity (2026-09-27): portal artists keyed by their STABLE label_artists.id. Resolution is id-first, so a
 * renamed artist (same id, new name) keeps his portal / slug. Only the ids the code actually knows are here —
 * DJ CLEANTONE's and נגש ביטס's label_artists ids are not recorded in code, so they still resolve by exact name
 * (a NAME_FALLBACK, reported as AMBIGUOUS identity quality, never silently equal to an id match).
 */
export const PORTAL_ARTISTS_BY_ID: Record<string, { name: string; slug: string }> = {
  [SHALEV_ARTIST_ID]: { name: SHALEV_NAME, slug: SHALEV_SLUG },
  [AVI_ARTIST_ID]:    { name: AVI_NAME,    slug: "avi-molla" },
};

export interface PortalIdentity {
  slug: string;
  /** The name the code registered (PORTAL_ARTISTS key) — NOT necessarily the artist's current DB name. */
  registeredName: string;
  basis: "ID" | "NAME_FALLBACK";
  /** ID = CANONICAL; a name-only match is AMBIGUOUS (another row could carry the same name after a rename). */
  quality: "CANONICAL" | "AMBIGUOUS";
}

/**
 * Resolve a label artist's portal: by label_artists.id first; by exact registered name only when the id is not an
 * id-registered portal artist AND the name is not the registered name of a DIFFERENT id-registered artist (so a
 * second row reusing "שליו טסמה" can never inherit Shalev's portal). Null = no portal.
 */
export function resolvePortalIdentity(artist: { id?: string | null; name?: string | null }, opts: { strict?: boolean } = {}): PortalIdentity | null {
  const byId = artist.id ? PORTAL_ARTISTS_BY_ID[artist.id] : undefined;
  if (byId) return { slug: byId.slug, registeredName: byId.name, basis: "ID", quality: "CANONICAL" };
  const name = artist.name ?? "";
  if (!isPortalArtistName(name)) return null;
  const idOwner = Object.entries(PORTAL_ARTISTS_BY_ID).find(([, v]) => v.name === name)?.[0];
  // strict (default — every ACCESS path): the name belongs to another (id-registered) artist → no portal.
  // Non-strict is for read-only DISPLAY (Sunny views): the name match is still returned, flagged AMBIGUOUS.
  if ((opts.strict ?? true) && idOwner && artist.id && idOwner !== artist.id) return null;
  return { slug: PORTAL_ARTISTS[name].slug, registeredName: name, basis: "NAME_FALLBACK", quality: "AMBIGUOUS" };
}

/** The label_artists.id registered in code for a portal NAME (only Shalev / Avi today), else null. */
export function registeredIdForPortalName(name: string | null | undefined): string | null {
  if (!name) return null;
  return Object.entries(PORTAL_ARTISTS_BY_ID).find(([, v]) => v.name === name)?.[0] ?? null;
}

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
