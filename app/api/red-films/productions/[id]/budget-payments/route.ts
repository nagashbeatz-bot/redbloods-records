/**
 * GET /api/red-films/productions/[id]/budget-payments
 * Returns all payments for a production (used by budget component for totals).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabase
      .from("red_films_budget_payments")
      .select("*")
      .eq("production_id", id)
      .order("payment_date", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ payments: data ?? [] });
  } catch (e) {
    console.error("[GET budget-payments]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
