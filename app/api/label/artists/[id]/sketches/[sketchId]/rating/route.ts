import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { setSketchRating, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks path traversal / arbitrary ids

/**
 * PATCH /api/label/artists/[id]/sketches/[sketchId]/rating
 *
 * OWNER-ONLY private star rating for one sketch. body: { rating: 1..5 | null }.
 * Stored as manifest metadata (`ratings` map) — never returned to the artist,
 * never touches the sketch's updatedAt / order / versions.
 *
 * `resolveOwnerPortalAccess` = requireOwner() + resolve the artistId to a portal
 * config, so a non-owner (shalev / avi / unknown) gets 401/403 here, and the
 * client-supplied slug/name is never trusted (always re-derived from the DB row).
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    if (!ID_RE.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const body = await req.json().catch(() => ({}));
    const raw = (body as { rating?: unknown }).rating;
    const rating = raw === null ? null : Number(raw);
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      throw new SketchError("BAD_INPUT", "דירוג חייב להיות בין 1 ל-5");
    }
    const ratings = await setSketchRating(access.config.slug, sketchId, rating);
    return NextResponse.json({ ok: true, ratings });
  } catch (err) {
    return errResponse(err);
  }
}
