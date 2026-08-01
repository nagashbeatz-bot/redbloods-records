import "server-only";
import { NextResponse } from "next/server";
import { requireOwner, getAuthRole } from "@/lib/require-auth";
import { AVI_ARTIST_ID } from "@/lib/roles";
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

export type PortalReadAccessResult =
  | { ok: true; config: ArtistPortalConfig; role: "owner" | "avi" }
  | { ok: false; response: NextResponse };

/**
 * READ access for the artist-scoped portal routes (GET handlers only): the owner
 * (any artist), OR a restricted artist reading ONLY their own id. The single
 * restricted reader today is Avi Molla, scoped to AVI_ARTIST_ID. WRITE handlers
 * keep using resolveOwnerPortalAccess (owner-only), so a restricted artist can
 * never mutate through these routes. `role` lets a route strip owner-only fields
 * (e.g. summary omits `balance` for role "avi").
 */
export async function resolvePortalReadAccess(artistId: string): Promise<PortalReadAccessResult> {
  const role = await getAuthRole();
  if (role === null) return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const aviScoped = role === "avi" && artistId === AVI_ARTIST_ID;
  if (role !== "owner" && !aviScoped) return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };

  const config = await resolvePortalConfig(artistId);
  if (!config) return { ok: false, response: NextResponse.json({ error: "אמן לא נמצא" }, { status: 404 }) };
  return { ok: true, config, role: role === "owner" ? "owner" : "avi" };
}
