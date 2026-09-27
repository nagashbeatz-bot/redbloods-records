import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { recordShowPayment, showPaymentRows, showPaymentState } from "@/lib/writes/show-payments";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/shows/[id]/payments — the show's money from Finance (D5): agreed / received / remaining / credit + payments.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await ctx.params;
  const st = await showPaymentState(id);
  if (!st) return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });
  const { money } = st;
  return NextResponse.json({ currency: money.currency, agreed: money.agreed, received: money.received, remaining: money.remaining, credit: money.credit, payments: await showPaymentRows(id) });
}

// POST /api/shows/[id]/payments — record money received (deposit / partial / full / overpayment) through the shared
// writer lib/writes/show-payments (the same one Sunny's RECORD_SHOW_PAYMENT uses).
export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const r = await recordShowPayment(id, { amount: body.amount, date: body.date, currency: body.currency, method: body.method ?? "", note: body.note });
    if (r.kind === "not_found") return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });
    if (r.kind === "refused") return NextResponse.json({ error: r.messageHe, code: r.code }, { status: r.code === "DUPLICATE" ? 409 : 400 });
    return NextResponse.json({ ok: true, received: r.after.received, remaining: r.after.remaining, credit: r.after.credit, currency: r.after.currency });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
