import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { reorderSketches, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

// PATCH /api/label/artists/[id]/sketches/reorder — set this artist's library
// display order. Body: { orderedIds: string[] }.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const body = await req.json().catch(() => ({}));
    const orderedIds = (body as { orderedIds?: unknown }).orderedIds;
    if (!Array.isArray(orderedIds)) throw new SketchError("BAD_INPUT", "חסרה רשימת סדר תקינה");
    const sketches = await reorderSketches(access.config.slug, orderedIds as string[]);
    return NextResponse.json({ ok: true, sketches });
  } catch (err) {
    return errResponse(err);
  }
}
