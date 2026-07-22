import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { uploadFinalFileSingle } from "@/lib/final-file-upload";

// Final delivery files — OWNER route. Stored ONLY in final_files + /Final Files/;
// never mix_versions, never the versions list / player / project-files.
export const maxDuration = 300;

/** POST /api/sound-engineer/[id]/final-files — single-shot (≤~150MB), original name kept. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "חסר קובץ" }, { status: 400 });

    const result = await uploadFinalFileSingle(workId, file);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, file: { id: result.file.id, fileName: result.file.fileName } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/final-files POST]", msg);
    return NextResponse.json({ ok: false, error: "שגיאת שרת" }, { status: 500 });
  }
}
