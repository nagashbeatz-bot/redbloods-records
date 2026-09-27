import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { recordVictorSalaryMonth } from "@/lib/writes/victor";

/**
 * Owner-only — Victor never sees salary in Phase 2A.
 * GET  /api/vendor/victor/salary?year=YYYY  — list salary months for a year
 * POST /api/vendor/victor/salary             — send a month to finance (creates transaction)
 * PATCH /api/vendor/victor/salary            — update amount and/or status override for a
 *                                              month (settings only — never touches Finance)
 */

/** 23505 on the Victor salary business key — and nothing else (other unique violations are real errors). */

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

    // Shared writer (lib/writes/victor) — duplicate-guarded by the salary key; a cancelled row is reused.
    const r = await recordVictorSalaryMonth({ workMonth, amount, currency, historicPaid, paidDate });
    if (r.kind === "error") return NextResponse.json({ ok: false, error: r.message }, { status: 500 });
    if (r.kind === "duplicate") return NextResponse.json({ ok: true, transaction: r.transaction, duplicate: true });
    return NextResponse.json({ ok: true, transaction: r.transaction });
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
