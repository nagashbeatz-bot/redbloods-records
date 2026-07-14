import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { reorderSketches, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

// PATCH /api/red-artists/sketches/reorder — set the library display order.
// Owner-only (same model as the rest of the sketches routes). Body: { orderedIds:
// string[] } — ids only; the server validates them and is the source of truth.
export async function PATCH(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const orderedIds = (body as { orderedIds?: unknown }).orderedIds;
    if (!Array.isArray(orderedIds)) throw new SketchError("BAD_INPUT", "חסרה רשימת סדר תקינה");
    const sketches = await reorderSketches(orderedIds as string[]);
    return NextResponse.json({ ok: true, sketches });
  } catch (err) {
    return errResponse(err);
  }
}
