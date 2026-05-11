import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file     = formData.get("file")      as File   | null;
    const projectId = formData.get("projectId") as string | null;
    const newName  = formData.get("newName")   as string | null;

    if (!file || !projectId || !newName) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }

    const { uploadFileToProject } = await import("@/lib/monday");
    const result = await uploadFileToProject(projectId, file, newName);
    return NextResponse.json({ ok: true, file: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
