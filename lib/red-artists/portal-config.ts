import "server-only";
import { getLabelArtist, getLabelArtistByName } from "@/lib/label-artists-store";
import { PORTAL_ARTISTS, SHALEV_NAME, SHALEV_SLUG, isPortalArtistName, resolvePortalIdentity, registeredIdForPortalName } from "@/lib/red-artists/portal-registry";

/**
 * Server-only DB resolution (artistId/name → row → portal config) on top of
 * the pure name↔slug registry in portal-registry.ts. Adding a new portal
 * artist is a one-line addition there; nothing else needs to change.
 */
export { SHALEV_NAME, SHALEV_SLUG, isPortalArtistName };

export interface ArtistPortalConfig {
  artistId: string;
  /** The artist's CURRENT label_artists.name (display snapshot). */
  name: string;
  slug: string;
  /** B4: how the portal was resolved — ID (canonical) or NAME_FALLBACK (ambiguous; artists without a code-registered id). */
  identity?: "ID" | "NAME_FALLBACK";
}

/** Resolve a portal config by label_artists.id (used for owner-driven, artistId-scoped access). */
export async function resolvePortalConfig(artistId: string): Promise<ArtistPortalConfig | null> {
  if (!artistId) return null;
  const artist = await getLabelArtist(artistId);
  if (!artist) return null;
  // B4: id first (a renamed artist keeps his portal); exact-name fallback only for artists without a code-registered id.
  const entry = resolvePortalIdentity({ id: artist.id, name: artist.name });
  if (!entry) return null;
  return { artistId: artist.id, name: artist.name, slug: entry.slug, identity: entry.basis };
}

/** Resolve a portal config by exact artist name (used to resolve an artist's OWN
 *  session, e.g. Shalev, where no artistId is ever supplied by the client). */
export async function resolvePortalConfigByName(name: string): Promise<ArtistPortalConfig | null> {
  const entry = PORTAL_ARTISTS[name];
  if (!entry) return null;
  // B4: a registered portal name with a known stable id resolves BY ID — so the artist's own session keeps working
  // after a rename in the roster (the name here is the code constant, e.g. SHALEV_NAME, not the DB value).
  const knownId = registeredIdForPortalName(name);
  if (knownId) {
    const byId = await getLabelArtist(knownId);
    if (byId) return { artistId: byId.id, name: byId.name, slug: entry.slug, identity: "ID" };
    return null; // the registered id is gone — never fall back to "whoever carries the name now"
  }
  const artist = await getLabelArtistByName(name);
  if (!artist) return null;
  return { artistId: artist.id, name: artist.name, slug: entry.slug, identity: "NAME_FALLBACK" };
}
