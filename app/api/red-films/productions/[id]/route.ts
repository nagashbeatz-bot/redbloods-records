/**
 * GET   /api/red-films/productions/[id] — fetch single production
 * PATCH /api/red-films/productions/[id] — update fields
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isManagedClipProduction } from "@/lib/clip-production";
import { updateProduction } from "@/lib/writes/redfilms";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabase
      .from("red_films_productions")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    // Computed, not stored: whether this production was created by its project's "שלח קליפ" (provenance only —
    // B3: it locks nothing; the budget is the production's own planning). Always false for legacy rows.
    const budgetManaged = await isManagedClipProduction(data as { id: string; project_id?: string | null });
    return NextResponse.json({ production: { ...data, budget_managed_by_project: budgetManaged } });
  } catch (e) {
    console.error("[GET /api/red-films/productions/[id]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// Fields that may be patched — whitelist to prevent injection
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "id חסר" }, { status: 400 });

    const body = await req.json();
    // Shared writer (lib/writes/redfilms): allowed fields (B3: no managed-budget lock), and — HARDENED — a cancel saves the
    // production first and only then cancels its future tasks / Google Tasks.
    const r = await updateProduction(id, body);
    if (r.kind === "empty") return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
    if (r.kind === "not_found") return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    return NextResponse.json({ production: r.production });
  } catch (e) {
    console.error("[PATCH /api/red-films/productions/[id]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
