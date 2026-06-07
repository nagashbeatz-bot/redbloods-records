/**
 * GET  /api/red-films/productions/[id]/budget-items — list items
 * POST /api/red-films/productions/[id]/budget-items — create item
 */
import { NextRequest, NextResponse } from "next/server";
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
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("red_films_budget_items")
      .insert({
        production_id: id,
        name: body.name ?? "",
        category: body.category ?? "",
        planned_amount: Number(body.planned_amount) || 0,
        actual_amount: Number(body.actual_amount) || 0,
        status: body.status ?? "פעיל",
        notes: body.notes ?? "",
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[POST budget-items]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
