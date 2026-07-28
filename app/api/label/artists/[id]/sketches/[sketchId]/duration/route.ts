import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { setSketchDuration, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

const ID_RE = /^[0-9a-fA-F-]{36}$/;

// POST /api/label/artists/[id]/sketches/[sketchId]/duration — persist a
// learned track length into this artist's manifest.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    if (!ID_RE.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const body = await req.json().catch(() => ({}));
    const versionNumber = Number(body.versionNumber);
    const durationSeconds = Number(body.durationSeconds);
    if (!Number.isFinite(versionNumber) || versionNumber < 1) throw new SketchError("BAD_INPUT", "מספר גרסה לא תקין");
    await setSketchDuration(access.config.slug, sketchId, Math.round(versionNumber), Math.round(durationSeconds));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errResponse(err);
  }
}
