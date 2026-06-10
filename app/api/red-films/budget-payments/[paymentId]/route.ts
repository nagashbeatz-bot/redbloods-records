/**
 * PATCH  /api/red-films/budget-payments/[paymentId] — update payment fields
 * DELETE /api/red-films/budget-payments/[paymentId] — delete payment
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ paymentId: string }> };

const ALLOWED = new Set([
  "amount", "payment_date", "payment_method", "notes",
  // Receipt fields — cleared when receipt is removed
  "receipt_file_name", "receipt_mime_type", "receipt_dropbox_path", "receipt_dropbox_url",
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { paymentId } = await ctx.params;
    const body = await req.json();
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.has(k)) fields[k] = v;
    }
    const { data, error } = await supabase
      .from("red_films_budget_payments")
      .update(fields)
      .eq("id", paymentId)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ payment: data });
  } catch (e) {
    console.error("[PATCH budget-payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { paymentId } = await ctx.params;
    const { error } = await supabase
      .from("red_films_budget_payments")
      .delete()
      .eq("id", paymentId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE budget-payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
