/**
 * PATCH  /api/red-films/budget-items/[itemId] — update item
 * DELETE /api/red-films/budget-items/[itemId] — delete item
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ itemId: string }> };

const ALLOWED = new Set([
  "name", "category", "planned_amount", "actual_amount", "status", "notes",
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;
    const body = await req.json();
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.has(k)) fields[k] = v;
    }
    const { data, error } = await supabase
      .from("red_films_budget_items")
      .update(fields)
      .eq("id", itemId)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e) {
    console.error("[PATCH budget-items]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;
    const { error } = await supabase
      .from("red_films_budget_items")
      .delete()
      .eq("id", itemId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE budget-items]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
