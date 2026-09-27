import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { deleteShowRecord, updateShowRecord } from "@/lib/writes/shows";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/shows/[id] — shared writer (lib/writes/shows): finance re-sync, close dialog, ledger close sync, tasks,
// calendar. The same writer Sunny's show primitives use.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const r = await updateShowRecord(id, body);
    if (r.kind === "not_found") return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });
    if (r.kind === "refused") return NextResponse.json({ error: r.messageHe, code: r.code }, { status: 409 });
    // A balance-sync failure means the request did NOT fully succeed, even though the show row itself was saved —
    // non-2xx so the client treats it as a failure. Retrying the same close action is always safe.
    if (r.kind === "balance_sync_failed") {
      return NextResponse.json({
        error: `ההופעה נשמרה, אך עדכון המאזן של האמן נכשל (${r.balanceSyncError}). ניתן לנסות לסגור את ההופעה שוב — הפעולה בטוחה לחזרה ולא תיצור כפילויות.`,
        show: r.show,
      }, { status: 502 });
    }
    return NextResponse.json({ show: r.show, ...(r.calendarWarning ? { calendarWarning: r.calendarWarning } : {}), ...(r.paymentReversalNeeded ? { paymentReversalNeeded: r.paymentReversalNeeded } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/shows/[id] — shared writer: blocked while rehearsals exist (409); finance rows hard-deleted, then the show.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const r = await deleteShowRecord(id);
    if (r.kind === "has_rehearsals") {
      return NextResponse.json({
        error: `להופעה יש ${r.rehearsalCount} חזרות מקושרות עם הוצאות — יש לטפל בהן לפני מחיקת ההופעה`,
        rehearsalCount: r.rehearsalCount,
      }, { status: 409 });
    }
    if (r.kind === "has_payments") {
      return NextResponse.json({ error: `להופעה יש ${r.paymentCount} תשלומים שהתקבלו — כסף שהתקבל לא נמחק. אפשר לבטל את ההופעה`, paymentCount: r.paymentCount }, { status: 409 });
    }
    return NextResponse.json({ ok: true, deletedTransactions: r.deletedTransactions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
