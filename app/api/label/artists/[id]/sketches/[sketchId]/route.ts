import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { patchDetails, softDeleteSketch, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks path traversal / arbitrary ids

// PATCH /api/label/artists/[id]/sketches/[sketchId] — edit details only.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    if (!ID_RE.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const body = await req.json().catch(() => ({}));
    const patch: { title?: string; description?: string; notes?: string } = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.notes === "string") patch.notes = body.notes;
    if (Object.keys(patch).length === 0) throw new SketchError("BAD_INPUT", "אין שינויים לשמירה");
    const sketch = await patchDetails(access.config.slug, sketchId, patch);
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}

// DELETE /api/label/artists/[id]/sketches/[sketchId] — soft delete (archived=true).
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    if (!ID_RE.test(sketchId)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    await softDeleteSketch(access.config.slug, sketchId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errResponse(err);
  }
}
