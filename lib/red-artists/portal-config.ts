import "server-only";
import { getLabelArtist, getLabelArtistByName } from "@/lib/label-artists-store";

/**
 * The registry of artists who have a full ArtistPortalPage — keyed by their
 * EXACT label_artists.name. Adding a new portal artist is a one-line addition
 * here; nothing else needs to change. `slug` drives Dropbox folder names and
 * settings keys, so it must NEVER change once an artist has real data.
 *
 * Shalev's slug ("shalev-tasama") is the EXACT literal already baked into his
 * existing Dropbox paths (/app/red-artists/shalev-tasama/...) and settings
 * keys — reusing it here means his data needs zero migration.
 */
const PORTAL_ARTISTS: Record<string, { slug: string }> = {
  "שליו טסמה": { slug: "shalev-tasama" },
  "אבי מולה":   { slug: "avi-molla" },
};

export const SHALEV_NAME = "שליו טסמה";
export const SHALEV_SLUG = "shalev-tasama";

export interface ArtistPortalConfig {
  artistId: string;
  name: string;
  slug: string;
}

/** True iff this exact label_artists.name has a registered portal. */
export function isPortalArtistName(name: string | null | undefined): boolean {
  return !!name && Object.prototype.hasOwnProperty.call(PORTAL_ARTISTS, name);
}

/** Resolve a portal config by label_artists.id (used for owner-driven, artistId-scoped access). */
export async function resolvePortalConfig(artistId: string): Promise<ArtistPortalConfig | null> {
  if (!artistId) return null;
  const artist = await getLabelArtist(artistId);
  if (!artist) return null;
  const entry = PORTAL_ARTISTS[artist.name];
  if (!entry) return null;
  return { artistId: artist.id, name: artist.name, slug: entry.slug };
}

/** Resolve a portal config by exact artist name (used to resolve an artist's OWN
 *  session, e.g. Shalev, where no artistId is ever supplied by the client). */
export async function resolvePortalConfigByName(name: string): Promise<ArtistPortalConfig | null> {
  const entry = PORTAL_ARTISTS[name];
  if (!entry) return null;
  const artist = await getLabelArtistByName(name);
  if (!artist) return null;
  return { artistId: artist.id, name: artist.name, slug: entry.slug };
}
