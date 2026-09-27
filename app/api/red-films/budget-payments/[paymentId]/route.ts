/**
 * PATCH  /api/red-films/budget-payments/[paymentId] — update payment fields
 * DELETE /api/red-films/budget-payments/[paymentId] — delete payment
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
    await deleteBudgetPayment(paymentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE budget-payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
