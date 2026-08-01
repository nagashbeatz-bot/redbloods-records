import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { updatePromotionFields, syncActualExpense, deletePromotion } from "@/lib/social-promotions-store";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/social/promotions/[id] → update planning fields and/or the actual spend
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    if (body.channel        !== undefined) patch.channel        = body.channel;
    if (body.promo_type     !== undefined) patch.promo_type     = body.promo_type;
    if (body.name           !== undefined) patch.name           = String(body.name).trim();
    if (body.planned_amount !== undefined) patch.planned_amount = Math.max(0, Number(body.planned_amount) || 0);
    if (body.status         !== undefined) patch.status         = body.status;
    if (body.promo_date     !== undefined) patch.promo_date     = body.promo_date || null;
    if (body.notes          !== undefined) patch.notes          = body.notes;

    if (Object.keys(patch).length > 0) await updatePromotionFields(id, patch);

    // Actual spend is only touched when the client explicitly sends it.
    if (body.actual !== undefined) await syncActualExpense(id, Number(body.actual) || 0);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[social/promotions/:id] PATCH error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

// DELETE /api/social/promotions/[id] → delete the promotion row ONLY (tx stays)
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;
    await deletePromotion(id);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    console.error("[social/promotions/:id] DELETE error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
