import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { cancelMedia, type MediaWriteResult } from "@/lib/media-income-store";

export const dynamic = "force-dynamic";

function mapWrite(res: MediaWriteResult): NextResponse {
  if (res.ok) return NextResponse.json({ ok: true, id: res.id });
  const status = res.code === "LM400" ? 400 : res.code === "LM403" ? 403 : res.code === "LM404" ? 404 : res.code === "LM409" ? 409 : 500;
  return NextResponse.json({ error: res.message || "שגיאת שרת" }, { status });
}

// POST /api/label/media/[recordId]/cancel — expected→בוטל; received→append reversal.
export async function POST(req: NextRequest, context: { params: Promise<{ recordId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { recordId } = await context.params;
    const body = await req.json();
    if (!body.artistId || typeof body.artistId !== "string") return NextResponse.json({ error: "מזהה אמן חסר" }, { status: 400 });
    if (typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt) return NextResponse.json({ error: "חסר חותם עדכון" }, { status: 400 });

    const res = await cancelMedia(recordId, body.artistId, body.expectedUpdatedAt);
    return mapWrite(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/media cancel POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
