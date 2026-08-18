import {
  isPortalSlug, slugForPortalArtistName,
  SHALEV_NAME, AVI_NAME, CLEANTONE_NAME,
} from "@/lib/red-artists/portal-registry";

/**
 * Who may read which beats.
 *
 * `beats` is one canonical repository; beat_artist_assignments decides which
 * artist SEES which beat. This resolves a request into exactly one scope, and it
 * does so from the caller's ROLE — the ?artist= parameter is advisory and is
 * honoured only for the owner (who previews artist portals). An artist role is
 * pinned to its own slug, so no artist can ask for another artist's beats or for
 * the unfiltered repository, no matter what they send.
 *
 * Pure and dependency-free so it can be unit-tested without a DB or a session.
 */

export type BeatScope =
  | { kind: "central"; artistSlug: undefined }              // owner, whole repository
  | { kind: "artist";  artistSlug: string }                 // one artist's assigned beats
  | { kind: "denied";  reason: string; status: 401 | 403 };

/** Artist roles that own a portal → the slug their beats live under. */
const ROLE_SLUG: Record<string, string | undefined> = {
  shalev:    slugForPortalArtistName(SHALEV_NAME)          ?? undefined,
  avi:       slugForPortalArtistName(AVI_NAME)             ?? undefined,
  cleantone: slugForPortalArtistName(CLEANTONE_NAME)       ?? undefined,
};

export function beatScopeForRole(role: string | null, requestedArtist: string | null): BeatScope {
  if (role === null)      return { kind: "denied", reason: "unauthorized", status: 401 };
  if (role === "unknown") return { kind: "denied", reason: "forbidden",    status: 403 };

  if (role === "owner") {
    if (requestedArtist === null || requestedArtist === "") return { kind: "central", artistSlug: undefined };
    // A typo'd or invented slug must not silently fall back to the whole repository.
    if (!isPortalSlug(requestedArtist)) return { kind: "denied", reason: "אמן לא מוכר", status: 403 };
    return { kind: "artist", artistSlug: requestedArtist };
  }

  // Every other role is pinned to its own portal — the parameter is ignored.
  const own = ROLE_SLUG[role];
  if (!own) return { kind: "denied", reason: "forbidden", status: 403 };
  return { kind: "artist", artistSlug: own };
}
