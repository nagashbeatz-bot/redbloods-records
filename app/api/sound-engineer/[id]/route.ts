import { NextRequest, NextResponse } from "next/server";
import {
  updateSoundEngineerWork,
  forceSyncTransaction,
  PaidExpenseProtectedError,
} from "@/lib/sound-engineer-store";
import { requireOwner } from "@/lib/require-auth";
import { deleteEngineerWorkClean } from "@/lib/writes/mix";
import type { SoundEngineerStatus, SoundEngineerWorkType } from "@/lib/types";
import type { StevenCompletionOutcome } from "@/lib/steven-completed-pure";

/**
 * PATCH /api/sound-engineer/[id]
 * Body: partial fields to update.
 * Finance-relevant changes run THE one expense writer (lib/writes/mix reconcileEngineerExpense) server-side — the
 * Steven page needs no second call. Un-pay while the linked expense is "שולם" → 409 (paid money is protected).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json() as Partial<{
      engineerName:     string;
      workType:         SoundEngineerWorkType;
      status:           SoundEngineerStatus;
      agreedPrice:      number;
      currency:         string;
      amountPaid:       number;
      sentDate:         string | null;
      internalDeadline: string | null;
      filesLink:        string | null;
      notes:            string;
      paymentDate:      string | null;
      skipFinanceSync:  boolean;
    }>;

    // internalDeadline (the manual deadline edit) is OWNER-ONLY — re-checked here
    // so a direct API call from any non-owner is rejected, not just hidden in the
    // UI. Scoped to this one field: no other field's authorization changes.
    if ("internalDeadline" in body) {
      const denied = await requireOwner();
      if (denied) return denied;
    }

    // Filled only when this PATCH was a real Steven work → completed transition, so the
    // owner's UI can refresh /projects or report that the project sync failed.
    const flow: { completion?: StevenCompletionOutcome } = {};
    const work = await updateSoundEngineerWork(id, body, {
      onStevenCompletion: (outcome) => { flow.completion = outcome; },
    });
    return NextResponse.json({ ok: true, work, ...(flow.completion ? { completion: flow.completion } : {}) });
  } catch (err) {
    if (err instanceof PaidExpenseProtectedError) return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 409 });
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/sound-engineer/[id]
 * Removes the work record (shared writer lib/writes/mix). HARDENED 2026-09-27: its linked expense is removed too when
 * it is NOT paid; a paid expense is kept as history.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const r = await deleteEngineerWorkClean(id);
    return NextResponse.json({ ok: true, removedExpense: r.removedExpense });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer/[id] — explicit "sync" of the linked expense (the drawer button). THE one writer with force:
 * a standalone work is refused, and a paid ("שולם") row is never overwritten — the response says what happened.
 * Owner only (also enforced by the proxy).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const result = await forceSyncTransaction(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
