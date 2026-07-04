import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { syncStevenPaymentExpense } from "@/lib/sound-engineer-store";

/**
 * POST /api/sound-engineer/[id]/payment-expense
 * Reconciles the Finance expense linked to this work's payment (create/update when
 * paid, delete when not) — keyed by sound_engineer_work.linked_transaction_id.
 * Owner only. Call AFTER the work's amount_paid/payment_date were saved.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const transactionId = await syncStevenPaymentExpense(id);
    return NextResponse.json({ ok: true, transactionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
