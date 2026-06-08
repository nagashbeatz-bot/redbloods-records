/**
 * GET /api/red-films/productions/[id]/documents
 * Returns all documents for a production, newest first.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;

    const { data, error } = await supabase
      .from("red_films_documents")
      .select("*")
      .eq("production_id", productionId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ documents: data ?? [] });
  } catch (e) {
    console.error("[GET /api/red-films/productions/[id]/documents]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
