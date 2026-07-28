import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { listSketches, createSketch, validateAudio } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

export const maxDuration = 300;

// GET /api/label/artists/[id]/sketches — owner preview of THIS artist's
// standalone music library (manifest-backed, own Dropbox subtree — never
// Shalev's, never any other artist's).
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const sketches = await listSketches(access.config.slug);
    return NextResponse.json({ ok: true, sketches });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/label/artists/[id]/sketches — create a new sketch (V1). Same
// contract as the Shalev-only route. No push is sent here — sketches-notify.ts
// is Shalev-only by design; this owner-preview path never triggers it.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const form = await req.formData();
    const title = (form.get("title") as string | null) ?? "";
    const description = (form.get("description") as string | null) ?? "";
    const notes = (form.get("notes") as string | null) ?? "";
    const audio = await validateAudio(form.get("file") as File | null);
    const sketch = await createSketch(access.config.slug, { title, description, notes, audio });
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}
