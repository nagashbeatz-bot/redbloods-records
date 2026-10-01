/**
 * GET /api/projects/[id]/clip — the project's video production link (read-only, operational).
 *
 * One clip model (Owner decision 2026-10-01): a clip is its own PROJECT (project_type "קליפ") with ONE agreedPrice — the
 * project's finance settings (PATCH /api/transactions?type=settings). There is no clip price, clip deal or clip payment
 * list here: this route only answers "which Red Films production is linked to this project" for the drawer's video tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { findLinkedClipProduction, getManagedClipProductionId } from "@/lib/clip-production";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;
    const [production, managedId] = await Promise.all([findLinkedClipProduction(id), getManagedClipProductionId(id)]);
    return NextResponse.json({
      production: production ? { ...production, budget_managed_by_project: managedId === production.id } : null,
    });
  } catch (e) {
    console.error("[GET /api/projects/[id]/clip]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
