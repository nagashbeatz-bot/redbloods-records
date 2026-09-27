import { NextRequest, NextResponse } from "next/server";
import { uploadSocialContentFile } from "@/lib/writes/uploads";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const contentItemId = formData.get("contentItemId") as string | null;
    const campaignId = formData.get("campaignId") as string | null;
    const projectId = (formData.get("projectId") as string | null) || null;
    if (!file) return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });
    if (!contentItemId || !campaignId) {
      return NextResponse.json({ error: "חסרים contentItemId / campaignId" }, { status: 400 });
    }
    // Shared writer (lib/writes/uploads) — the same one Sunny's file channel uses (500MB limit, same folders, share link).
    const r = await uploadSocialContentFile(contentItemId, campaignId, projectId, file);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, file: r.file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[social/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
