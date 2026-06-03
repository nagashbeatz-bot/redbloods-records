import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/clip-items/[id]
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.category    !== undefined) patch.category    = body.category;
    if (body.description !== undefined) patch.description = body.description;
    if (body.amount      !== undefined) patch.amount      = Number(body.amount);
    if (body.currency    !== undefined) patch.currency    = body.currency;
    if (body.status      !== undefined) patch.status      = body.status;
    if (body.notes       !== undefined) patch.notes       = body.notes;

    const { data, error } = await supabase
      .from("clip_items")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ clipItem: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאה" }, { status: 500 });
  }
}

// DELETE /api/clip-items/[id]
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { error } = await supabase.from("clip_items").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאה" }, { status: 500 });
  }
}
