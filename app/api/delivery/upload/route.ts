import { NextRequest, NextResponse } from "next/server";
import { uploadToDelivery } from "@/lib/writes/uploads";

// POST /api/delivery/upload
// FormData: { file: File, projectId: string } — shared writer (lib/writes/uploads), overwrite mode as before.
export async function POST(req: NextRequest) {
  const formData  = await req.formData();
  const file      = formData.get("file")      as File   | null;
  const projectId = formData.get("projectId") as string | null;
  if (!file || !projectId) {
    return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
  }
  try {
    const r = await uploadToDelivery(projectId, file);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, file: r.file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dropbox לא מחובר" }, { status: 500 });
  }
}
