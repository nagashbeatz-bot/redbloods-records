/**
 * PATCH  /api/red-films/budget-items/[itemId] — update item
 * DELETE /api/red-films/budget-items/[itemId] — delete item
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteBudgetLine, updateBudgetLine } from "@/lib/writes/redfilms";

type Ctx = { params: Promise<{ itemId: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;
    const body = await req.json();
    const data = await updateBudgetLine(itemId, body); // shared writer (lib/writes/redfilms)
    return NextResponse.json({ item: data });
  } catch (e) {
    console.error("[PATCH budget-items]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;
    await deleteBudgetLine(itemId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE budget-items]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
