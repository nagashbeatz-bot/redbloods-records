import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/proposals/[id] — update fields
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    if (body.title         !== undefined) patch.title         = body.title;
    if (body.amount        !== undefined) patch.amount        = Number(body.amount) || 0;
    if (body.currency      !== undefined) patch.currency      = body.currency;
    if (body.status        !== undefined) patch.status        = body.status;
    if (body.sentDate      !== undefined) patch.sent_date     = body.sentDate     || null;
    if (body.followupDate  !== undefined) patch.followup_date = body.followupDate || null;
    if (body.notes         !== undefined) patch.notes         = body.notes;
    if (body.linkedProjectId !== undefined) patch.linked_project_id = body.linkedProjectId || null;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("proposals")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/proposals/[id]
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { error } = await supabase.from("proposals").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/proposals/[id]/convert — handled in /[id]/convert/route.ts
