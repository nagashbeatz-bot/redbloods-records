import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// PATCH /api/transactions/[id]  → update a transaction
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const patch: Record<string, unknown> = {};
  if (body.date           !== undefined) patch.date           = body.date || null;
  if (body.description    !== undefined) patch.description    = body.description;
  if (body.artist         !== undefined) patch.artist         = body.artist;
  if (body.amount         !== undefined) patch.amount         = Number(body.amount);
  if (body.currency       !== undefined) patch.currency       = body.currency;
  if (body.paymentStatus  !== undefined) patch.payment_status = body.paymentStatus;
  if (body.paymentMethod  !== undefined) patch.payment_method = body.paymentMethod;
  if (body.receiptRef     !== undefined) patch.receipt_ref    = body.receiptRef;
  if (body.notes          !== undefined) patch.notes          = body.notes;
  if (body.category       !== undefined) patch.category       = body.category;
  if (body.type           !== undefined) patch.type           = body.type;

  const { data, error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transaction: data });
}

// DELETE /api/transactions/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
