import { NextRequest, NextResponse } from "next/server";

/**
 * GET  /api/vendor/victor/salary?year=YYYY  — list salary months for a year
 * POST /api/vendor/victor/salary             — send a month to finance (creates transaction)
 * PATCH /api/vendor/victor/salary            — update amount override for a month
 */

export async function GET(req: NextRequest) {
  try {
    const year = parseInt(
      req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear()),
      10
    );
    const { getVictorSalaryMonths } = await import("@/lib/vendor-store");
    const months = await getVictorSalaryMonths(year);
    return NextResponse.json({ ok: true, months });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { workMonth, amount, currency, historicPaid = false, paidDate } = (await req.json()) as {
      workMonth: string;
      amount: number;
      currency: string;
      historicPaid?: boolean;
      paidDate?: string;
    };

    const { supabase } = await import("@/lib/supabase");
    const { salaryLinkedId, salaryDueDate, salaryMonthLabel } = await import("@/lib/vendor-store");

    const linkedId   = salaryLinkedId(workMonth);
    const dueDate    = salaryDueDate(workMonth);
    const monthLabel = salaryMonthLabel(workMonth);

    // Guard: no duplicate
    const { data: existing } = await supabase
      .from("transactions")
      .select("id, payment_status")
      .eq("linked_session_id", linkedId)
      .maybeSingle();

    if (existing) {
      const ex = existing as { id: string; payment_status: string };
      if (ex.payment_status !== "בוטל") {
        // Active transaction exists — no duplicate
        return NextResponse.json({ ok: true, transaction: existing, duplicate: true });
      }
      // Cancelled transaction — reuse it by updating instead of inserting
      const { data: updated, error: updateErr } = await supabase
        .from("transactions")
        .update({
          payment_status: historicPaid ? "שולם" : "לא שולם",
          amount,
          currency,
          date:  paidDate ?? dueDate,
          notes: historicPaid ? "סומן כשולם היסטורית מתוך כרטיס Victor" : "",
        })
        .eq("id", ex.id)
        .select()
        .single();
      if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, transaction: updated });
    }

    const { data, error } = await supabase
      .from("transactions")
      .insert({
        scope:             "general",
        type:              "expense",
        project_id:        null,
        artist:            "Victor",
        description:       `משכורת Victor — ${monthLabel}`,
        amount:            amount,
        currency:          currency,
        payment_status:    historicPaid ? "שולם" : "לא שולם",
        category:          "צוות",
        date:              paidDate ?? dueDate,
        linked_session_id: linkedId,
        notes:             historicPaid ? "סומן כשולם היסטורית מתוך כרטיס Victor" : "",
        payment_method:    "",
        receipt_ref:       "",
        expense_scope:     "כללי",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, transaction: data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { workMonth, amount } = (await req.json()) as {
      workMonth: string;
      amount: number;
    };
    const { setSalaryAmountOverride } = await import("@/lib/vendor-store");
    await setSalaryAmountOverride(workMonth, amount);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
