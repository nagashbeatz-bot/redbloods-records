/**
 * GET  /api/red-films/productions/[id]/budget-items — list items
 * POST /api/red-films/productions/[id]/budget-items — create item
 */
import { NextRequest, NextResponse } from "next/server";
import { createBudgetLine } from "@/lib/writes/redfilms";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabase
      .from("red_films_budget_items")
      .select("*")
      .eq("production_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (e) {
    console.error("[GET budget-items]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const data = await createBudgetLine(id, body); // shared writer (lib/writes/redfilms)
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    console.error("[POST budget-items]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
