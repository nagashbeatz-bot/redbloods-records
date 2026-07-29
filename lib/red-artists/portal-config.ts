import "server-only";
import { getLabelArtist, getLabelArtistByName } from "@/lib/label-artists-store";
import { PORTAL_ARTISTS, SHALEV_NAME, SHALEV_SLUG, isPortalArtistName } from "@/lib/red-artists/portal-registry";

/**
 * Server-only DB resolution (artistId/name → row → portal config) on top of
 * the pure name↔slug registry in portal-registry.ts. Adding a new portal
 * artist is a one-line addition there; nothing else needs to change.
 */
export { SHALEV_NAME, SHALEV_SLUG, isPortalArtistName };

export interface ArtistPortalConfig {
  artistId: string;
  name: string;
  slug: string;
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
