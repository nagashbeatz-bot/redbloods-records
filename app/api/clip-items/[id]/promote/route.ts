import { NextRequest, NextResponse } from "next/server";
import { promoteClipItem } from "@/lib/writes/redfilms";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/clip-items/[id]/promote
 * Creates a real transaction from a planning clip_item.
 * Sets clip_item.status = "הועבר לכספים" and stores the new transaction ID.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { date } = body as { date?: string };
    if (!date) return NextResponse.json({ error: "תאריך חובה" }, { status: 400 });

    // Fetch the clip_item
    // Shared writer (lib/writes/redfilms) — HARDENED: the row is claimed before the expense is created (no double
    // expense on a double click); a failed expense restores the row.
    const r = await promoteClipItem(id, date);
    if (r.kind === "not_found") return NextResponse.json({ error: "clip item not found" }, { status: 404 });
    if (r.kind === "already_promoted") return NextResponse.json({ error: "already_promoted", linked_transaction_id: r.transactionId }, { status: 409 });
    const tx = r.transaction;
    return NextResponse.json({ deleted: true, transaction: tx });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
