import { NextRequest, NextResponse } from "next/server";
import { patchShow, deleteShow } from "@/lib/shows-store";
import type { PatchShowInput, ShowStatus, PaymentStatus } from "@/lib/shows-store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const patch: PatchShowInput = {};

    if (body.name           !== undefined) patch.name           = body.name?.trim()           ?? "";
    if (body.artist         !== undefined) patch.artist         = body.artist?.trim()         ?? "";
    if (body.date           !== undefined) patch.date           = body.date                   || null;
    if (body.start_time     !== undefined) patch.start_time     = body.start_time             || null;
    if (body.location       !== undefined) patch.location       = body.location?.trim()       ?? "";
    if (body.contact_person !== undefined) patch.contact_person = body.contact_person?.trim() ?? "";
    if (body.phone          !== undefined) patch.phone          = body.phone?.trim()          ?? "";
    if (body.status         !== undefined) patch.status         = body.status     as ShowStatus;
    if (body.payment_status !== undefined) patch.payment_status = body.payment_status as PaymentStatus;
    if (body.show_price     !== undefined) patch.show_price     = Number(body.show_price)     || 0;
    if (body.dj_fee         !== undefined) patch.dj_fee         = Number(body.dj_fee);
    if (body.advance_payment!== undefined) patch.advance_payment= Number(body.advance_payment)|| 0;
    if (body.notes          !== undefined) patch.notes          = body.notes                  ?? "";

    const show = await patchShow(id, patch);
    return NextResponse.json({ show });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteShow(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
