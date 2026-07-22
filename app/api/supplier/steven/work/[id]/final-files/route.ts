import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { assertStevenOwnsWork } from "@/lib/steven-scope";
import { uploadFinalFileSingle } from "@/lib/final-file-upload";

// Final delivery files — STEVEN route (own work only). Stored ONLY in final_files +
// /Final Files/; never mix_versions. Response carries no Dropbox path.
export const maxDuration = 300;

const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

/** POST /api/supplier/steven/work/[id]/final-files — single-shot, original name kept. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    if (!(await assertStevenOwnsWork(workId))) return FORBID();

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "חסר קובץ" }, { status: 400 });

    const result = await uploadFinalFileSingle(workId, file);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, file: { id: result.file.id, fileName: result.file.fileName } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[supplier/steven/final-files POST]", msg);
    return NextResponse.json({ ok: false, error: "שגיאת שרת" }, { status: 500 });
  }
}
