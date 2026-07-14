import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { patchDetails, softDeleteSketch, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks path traversal / arbitrary ids

// PATCH /api/red-artists/sketches/[id] — edit details only (title/description/notes).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!ID_RE.test(id)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const body = await req.json().catch(() => ({}));
    const patch: { title?: string; description?: string; notes?: string } = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.notes === "string") patch.notes = body.notes;
    if (Object.keys(patch).length === 0) throw new SketchError("BAD_INPUT", "אין שינויים לשמירה");
    const sketch = await patchDetails(id, patch);
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}

// DELETE /api/red-artists/sketches/[id] — soft delete (archived=true). Files stay in
// Dropbox; the record stays in the manifest. Nothing is physically deleted.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!ID_RE.test(id)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    await softDeleteSketch(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errResponse(err);
  }
}
