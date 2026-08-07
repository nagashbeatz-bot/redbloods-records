import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { setBeat, validateAudio, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

export const maxDuration = 300;
const ID_RE = /^[0-9a-fA-F-]{36}$/;

// POST /api/label/artists/[id]/sketches/[sketchId]/beat — attach or replace the
// project's companion beat/instrumental. Owner-only (resolveOwnerPortalAccess),
// exactly like the version upload — Avi never writes. Not a version: setBeat
// leaves versions / latestVersion / the player latest untouched.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    if (!ID_RE.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const form = await req.formData();
    const audio = await validateAudio((form.get("beat") ?? form.get("file")) as File | null);
    const sketch = await setBeat(access.config.slug, sketchId, audio);
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}
