/**
 * GET /api/red-films/productions/[id]/references
 * Returns all reference images for a production, ordered by sort_order then created_at.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabase
      .from("red_films_reference_images")
      .select("*")
      .eq("production_id", id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ references: data ?? [] });
  } catch (e) {
    console.error("[GET /api/red-films/productions/[id]/references]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
