import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { reconcileWorkPaymentExpense } from "@/lib/sound-engineer-store";

/**
 * POST /api/sound-engineer/[id]/payment-expense
 * Reconciles the Finance expense linked to this work's payment through THE one writer (lib/writes/mix
 * reconcileEngineerExpense): work currency, a "שולם" row is never overwritten or deleted, an unpaid expected row may be
 * removed. Owner only. Idempotent — the work PATCH already reconciles server-side, so this is a no-op safety re-run.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const r = await reconcileWorkPaymentExpense(id);
    return NextResponse.json({ ok: true, transactionId: r.txId, outcome: r.kind, message: r.messageHe, conflict: r.conflictHe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
