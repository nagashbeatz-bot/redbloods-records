import { NextRequest, NextResponse } from "next/server";
import { deleteVideoReference, updateVideoReference } from "@/lib/writes/redfilms";

type Ctx = { params: Promise<{ linkId: string }> };

// ── PATCH /api/red-films/reference-links/[linkId] — shared writer; only title / notes (hardened) ─────────────────
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { linkId } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const data = await updateVideoReference(linkId, body as Record<string, unknown>);
    if (data === "empty") return NextResponse.json({ error: "אין שדות לעדכון (title / notes)" }, { status: 400 });
    return NextResponse.json({ link: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 });
  }
}

// ── DELETE /api/red-films/reference-links/[linkId] — shared writer ─────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { linkId } = await params;
  try { await deleteVideoReference(linkId); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
