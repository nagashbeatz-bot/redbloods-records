/**
 * POST /api/red-films/productions/[id]/documents/upload
 * FormData: { file: File, fileType: string, notes?: string }
 * Shared writer (lib/writes/uploads): auto-named document, share link, metadata row.
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadRfDocument } from "@/lib/writes/uploads";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;
    const formData = await req.formData();
    const file     = formData.get("file")     as File   | null;
    const fileType = formData.get("fileType") as string | null;
    const notes    = (formData.get("notes")   as string | null) ?? "";
    if (!file) return NextResponse.json({ error: "קובץ חסר" }, { status: 400 });
    const r = await uploadRfDocument(productionId, file, fileType, notes);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ document: r.document }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/productions/[id]/documents/upload]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
