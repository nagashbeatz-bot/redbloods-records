/**
 * POST /api/red-films/productions/[id]/references/upload
 * FormData: { file: File, tag?: string }
 * Shared writer (lib/writes/uploads): image + thumbnail link + metadata row.
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadRfReferenceImage } from "@/lib/writes/uploads";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const tag  = (formData.get("tag") as string | null)?.trim() || "כללי";
    if (!file) return NextResponse.json({ error: "קובץ חסר" }, { status: 400 });
    const r = await uploadRfReferenceImage(productionId, file, tag);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ reference: r.reference }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/productions/[id]/references/upload]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
