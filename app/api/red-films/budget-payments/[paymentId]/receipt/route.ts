/**
 * POST /api/red-films/budget-payments/[paymentId]/receipt
 * FormData: { receipt: File }
 * Shared writer (lib/writes/uploads): uploads the receipt and updates the payment record.
 */
import { NextRequest, NextResponse } from "next/server";
import { attachReceiptToPayment } from "@/lib/writes/uploads";

export const maxDuration = 300;

type Ctx = { params: Promise<{ paymentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { paymentId } = await ctx.params;
    const form        = await req.formData();
    const receiptFile = form.get("receipt") as File | null;
    if (!receiptFile || receiptFile.size === 0) return NextResponse.json({ error: "קובץ חסר" }, { status: 400 });
    const r = await attachReceiptToPayment(paymentId, receiptFile);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ payment: r.payment });
  } catch (e) {
    console.error("[POST budget-payment/receipt]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
