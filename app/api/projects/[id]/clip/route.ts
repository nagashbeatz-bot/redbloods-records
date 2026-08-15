/**
 * GET   /api/projects/[id]/clip — clip-deal snapshot for a project
 * PATCH /api/projects/[id]/clip — set the agreed clip price
 *
 * The clip deal is stored WITHOUT any schema change:
 *   • price     → settings["finance_<projectId>"].clipAgreedPrice (JSONB key)
 *   • payments  → real transactions rows, expense_scope = "קליפ"
 *   • Red Films → red_films_productions.project_id (already existed)
 *
 * The project's clipAgreedPrice is the SINGLE SOURCE OF TRUTH for the price.
 * When it changes and a linked Red Films production exists, that production's
 * general_budget (תקציב) is pushed to match — one direction only, never back.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";
import { CLIP_SCOPE } from "@/lib/clip-finance";
import { findLinkedClipProduction, getManagedClipProductionId, syncClipBudget } from "@/lib/clip-production";

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
    // its budget is not ours to sync, and the UI must not claim otherwise.
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
    const existing = await readFinanceSettings(id);
    const merged   = { ...existing, clipAgreedPrice: price };

    const { error } = await supabase
      .from("settings")
      .upsert({ key: `finance_${id}`, value: merged }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Price → budget sync (one-way). Already-linked production only; never creates one.
    const budgetSynced = await syncClipBudget(id, price);

    return NextResponse.json({ ok: true, clipAgreedPrice: price, budgetSynced });
  } catch (e) {
    console.error("[PATCH /api/projects/[id]/clip]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
