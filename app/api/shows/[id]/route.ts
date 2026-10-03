import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { deleteShowRecord, deleteShowCompletely, updateShowRecord } from "@/lib/writes/shows";
import { ShowFinanceSyncError } from "@/lib/shows-finance-sync";
import { getShow } from "@/lib/shows-store";

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
        partial: true,
      }, { status: 502 });
    }
    return NextResponse.json({ show: r.show, ...(r.calendarWarning ? { calendarWarning: r.calendarWarning } : {}), ...(r.financeWarning ? { financeWarning: r.financeWarning } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    // Phase 1 (B4): the show row is saved BEFORE the finance sync — a failed sync means "saved, but the money sync did not
    // finish". Answer with the saved show + partial so the screen refreshes and says so (never a plain "nothing saved").
    if (err instanceof ShowFinanceSyncError) {
      const { id } = await ctx.params;
      const saved = await getShow(id).catch(() => null);
      return NextResponse.json({ error: msg, partial: true, ...(saved ? { show: saved } : {}) }, { status: 502 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/shows/[id] — shared writer: blocked while rehearsals / received payments / paid DJ-artist fees exist (409);
// the still-expected finance rows are hard-deleted, then the show.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    // ?complete=1 — the hub delete (calendar event + linked tasks + show), every refusal checked BEFORE any write
    const complete = req.nextUrl.searchParams.get("complete") === "1";
    const r = complete ? await deleteShowCompletely(id) : await deleteShowRecord(id);
    if (r.kind === "not_found") return NextResponse.json({ error: "ההופעה לא נמצאה" }, { status: 404 });
    if (r.kind === "has_rehearsals") {
      return NextResponse.json({
        error: `להופעה יש ${r.rehearsalCount} חזרות מקושרות עם הוצאות — יש לטפל בהן לפני מחיקת ההופעה`,
        rehearsalCount: r.rehearsalCount,
      }, { status: 409 });
    }
    if (r.kind === "has_payments") {
      return NextResponse.json({ error: `להופעה יש ${r.paymentCount} תשלומים שהתקבלו — כסף שהתקבל לא נמחק. אפשר לבטל את ההופעה`, paymentCount: r.paymentCount }, { status: 409 });
    }
    if (r.kind === "has_paid_fees") return NextResponse.json({ error: r.messageHe, code: "HAS_PAID_FEES" }, { status: 409 });
    return NextResponse.json({ ok: true, deletedTransactions: r.deletedTransactions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
