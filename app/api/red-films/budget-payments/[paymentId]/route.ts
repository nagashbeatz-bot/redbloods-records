/**
 * PATCH  /api/red-films/budget-payments/[paymentId] — update payment fields
 * DELETE /api/red-films/budget-payments/[paymentId] — delete payment
 * DB-1: an edit propagates amount / date / method to the linked Finance expense; a delete removes it with the payment.
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteBudgetPayment, updateBudgetPayment } from "@/lib/writes/redfilms";

type Ctx = { params: Promise<{ paymentId: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { paymentId } = await ctx.params;
    const body = await req.json();
    const data = await updateBudgetPayment(paymentId, body); // shared writer (lib/writes/redfilms)
    return NextResponse.json({ payment: data });
  } catch (e) {
    console.error("[PATCH budget-payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { paymentId } = await ctx.params;
    const r = await deleteBudgetPayment(paymentId); // shared writer — its linked Finance expense is deleted with it
    return NextResponse.json({ ok: true, deletedTransactionId: r.deletedTransactionId });
  } catch (e) {
    console.error("[DELETE budget-payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
