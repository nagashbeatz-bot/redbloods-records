/**
 * GET   /api/projects/[id]/clip — clip-deal snapshot for a project
 * PATCH /api/projects/[id]/clip — set the agreed clip price
 *
 * The clip deal is stored WITHOUT any schema change:
 *   • price     → settings["finance_<projectId>"].clipAgreedPrice (JSONB key)
 *   • payments  → real transactions rows, expense_scope = "קליפ"
 *   • Red Films → red_films_productions.project_id (already existed)
 *
 * The project's clipAgreedPrice is the SINGLE SOURCE OF TRUTH for the CLIENT clip price (A).
 * B3 (Owner canon 2026-09-27): it never writes a Red Films production's general_budget — the planned budget (B) is
 * the production's own planning; the old price → budget sync is retired.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";
import { CLIP_SCOPE } from "@/lib/clip-finance";
import { findLinkedClipProduction, getManagedClipProductionId } from "@/lib/clip-production";
import { setClipPrice } from "@/lib/writes/clip";

type Ctx = { params: Promise<{ id: string }> };

async function readFinanceSettings(projectId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `finance_${projectId}`)
    .maybeSingle();
  return (data?.value ?? {}) as Record<string, unknown>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;

    const [settings, txRes, production, managedId] = await Promise.all([
      readFinanceSettings(id),
      supabase
        .from("transactions")
        .select("*")
        .eq("project_id", id)
        .eq("expense_scope", CLIP_SCOPE)
        .eq("type", "income")
        .order("date", { ascending: true }),
      findLinkedClipProduction(id),
      getManagedClipProductionId(id),
    ]);

    if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 });

    // A linked production may be LEGACY — created in Red Films before this flow
    // existed. It still answers "don't create a second one" and "open it", but
    // budget_managed_by_project = created by "שלח קליפ" (provenance only; B3: never a budget sync or lock).
    const budgetManaged = !!production && production.id === managedId;

    return NextResponse.json({
      clipAgreedPrice: (settings.clipAgreedPrice as number | undefined) ?? 0,
      currency:        (settings.currency        as string | undefined) ?? "₪",
      payments:        txRes.data ?? [],
      production:      production ? { ...production, budget_managed_by_project: budgetManaged } : null,
    });
  } catch (e) {
    console.error("[GET /api/projects/[id]/clip]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { clipAgreedPrice } = body as { clipAgreedPrice?: number };

    if (clipAgreedPrice === undefined) {
      return NextResponse.json({ error: "clipAgreedPrice חובה" }, { status: 400 });
    }
    const price = Number(clipAgreedPrice);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "מחיר לא תקין" }, { status: 400 });
    }

    // Merge into the existing finance settings blob — never overwrite other keys.
    await setClipPrice(id, price); // shared writer (lib/writes/clip) — B3: the price only, never the production budget
    return NextResponse.json({ ok: true, clipAgreedPrice: price });
  } catch (e) {
    console.error("[PATCH /api/projects/[id]/clip]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
