import { NextRequest, NextResponse } from "next/server";
import { updateProposal, deleteProposal } from "@/lib/writes/proposals";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/proposals/[id] — update fields (+ follow-up task management). Shared writer: lib/writes/proposals.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const data = await updateProposal(id, body);
    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/proposals/[id] (its follow-up task first, best-effort). Shared writer: lib/writes/proposals.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteProposal(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/proposals/[id]/convert — handled in /[id]/convert/route.ts
