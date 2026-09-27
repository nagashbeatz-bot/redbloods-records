/**
 * POST /api/projects/[id]/clip/payments — create clip-deal income transaction(s)
 *
 * Every clip payment is a REAL transactions row (type="income", scope="project",
 * expense_scope="קליפ") — the same rows the Finance page renders. There is no
 * parallel payments table. Editing / deleting a payment goes through the normal
 * /api/transactions/[id] endpoints, so status logic stays in one place.
 *
 * Body:
 *   { seed: true }  → open a clip deal: two default payments (מקדמה + יתרה,
 *                     50/50 of the agreed price). No-ops if clip payments
 *                     already exist, so a double click can't duplicate them.
 *   otherwise       → one payment: { amount, date, category, paymentStatus, notes }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { addClipPayments, ClipInputError } from "@/lib/writes/clip";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    // Shared writer (lib/writes/clip) — the 50 / 50 seed of an open deal, or one clip payment.
    try {
      const r = await addClipPayments(id, body);
      if (r.kind === "not_found") return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });
      return r.created ? NextResponse.json({ payments: r.payments, created: true }, { status: 201 }) : NextResponse.json({ payments: r.payments, created: false });
    } catch (e) {
      if (e instanceof ClipInputError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  } catch (e) {
    console.error("[POST /api/projects/[id]/clip/payments]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאת שרת" }, { status: 500 });
  }
}
