import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * Owner-only — Victor never sees salary in Phase 2A.
 * GET  /api/vendor/victor/salary?year=YYYY  — list salary months for a year
 * POST /api/vendor/victor/salary             — send a month to finance (creates transaction)
 * PATCH /api/vendor/victor/salary            — update amount and/or status override for a
 *                                              month (settings only — never touches Finance)
 */

/** 23505 on the Victor salary business key — and nothing else (other unique violations are real errors). */
function isVictorSalaryKeyConflict(e: { code?: string; message?: string; details?: string | null }): boolean {
  return e.code === "23505" && /\btransactions_victor_salary_period_uk\b/.test(`${e.message ?? ""} ${e.details ?? ""}`);
}

export async function GET(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
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
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { workMonth, amount, currency, historicPaid = false, paidDate } = (await req.json()) as {
      workMonth: string;
      amount: number;
      currency: string;
      historicPaid?: boolean;
      paidDate?: string;
    };

    const { supabase } = await import("@/lib/supabase");
    const { salaryLinkedId, salaryDueDate, salaryTransactionDescription } = await import("@/lib/vendor-store");

    const linkedId   = salaryLinkedId(workMonth);
    const dueDate    = salaryDueDate(workMonth);

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
        description:       salaryTransactionDescription(workMonth),
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

    if (error) {
      // A concurrent writer committed the same salary period first. With the (future) DB business-key index
      // transactions_victor_salary_period_uk the DB — not the read above — is the final guard; only THAT exact
      // conflict becomes the same safe duplicate answer as the pre-check. Every other error still fails.
      if (isVictorSalaryKeyConflict(error)) {
        const { data: winner } = await supabase
          .from("transactions")
          .select("id, payment_status")
          .eq("linked_session_id", linkedId)
          .maybeSingle();
        const w = winner as { id: string; payment_status: string } | null;
        if (w && w.payment_status !== "בוטל") return NextResponse.json({ ok: true, transaction: w, duplicate: true });
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, transaction: data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { workMonth, amount, status } = (await req.json()) as {
      workMonth: string;
      amount?: number;
      status?: string;
    };
    if (!workMonth) {
      return NextResponse.json({ ok: false, error: "workMonth חסר" }, { status: 400 });
    }
    const { setSalaryAmountOverride, setSalaryStatusOverride } = await import("@/lib/vendor-store");
    // Settings-only overrides — no transactions created or updated.
    if (amount !== undefined) await setSalaryAmountOverride(workMonth, Number(amount) || 0);
    if (status !== undefined) await setSalaryStatusOverride(workMonth, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
