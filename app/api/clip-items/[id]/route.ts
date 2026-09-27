import { NextRequest, NextResponse } from "next/server";
import { deleteClipItem, RfInputError, updateClipItem } from "@/lib/writes/redfilms";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/clip-items/[id]
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const data = await updateClipItem(id, body); // shared writer (lib/writes/redfilms) — status validated (B3)
    return NextResponse.json({ clipItem: data });
  } catch (err) {
    if (err instanceof RfInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאה" }, { status: 500 });
  }
}

// DELETE /api/clip-items/[id]
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteClipItem(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאה" }, { status: 500 });
  }
}
