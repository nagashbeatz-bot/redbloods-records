import "server-only";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { resolvePortalConfig, type ArtistPortalConfig } from "@/lib/red-artists/portal-config";

/**
 * Auth + resolution for the OWNER-driven, artist-scoped portal routes
 * (app/api/label/artists/[artistId]/*). These are ADDITIVE and completely
 * separate from Shalev's own existing routes (app/api/red-artists/*, which
 * remain untouched and always resolve to his own slug directly) — this phase
 * intentionally covers the owner-preview case only; no artist (including Avi)
 * has their own login/session here yet.
 */
export type PortalAccessResult =
  | { ok: true; config: ArtistPortalConfig }
  | { ok: false; response: NextResponse };

/** Owner-only + resolves `artistId` to a registered portal artist's config
 *  (never trusts a client-sent slug/name — always re-derived from the DB row). */
export async function resolveOwnerPortalAccess(artistId: string): Promise<PortalAccessResult> {
  const denied = await requireOwner();
  if (denied) return { ok: false, response: denied };

  const config = await resolvePortalConfig(artistId);
  if (!config) return { ok: false, response: NextResponse.json({ error: "אמן לא נמצא" }, { status: 404 }) };
  return { ok: true, config };
}
