import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { markQuoteSent } from "@/lib/writes/shows";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/shows/[id]/quote-sent
 * Called by the UI right AFTER a quote ("הצעת מחיר") was saved (POST/PATCH).
 * Server-authoritative: reads the freshly-saved show and upserts its single
 * "פולואפ להצעת מחיר" task (dedup by show_id + marker). No Push.
 * Only acts for pipeline (lead/quote) shows; a no-op for confirmed ones.
 * Shared writer: lib/writes/shows markQuoteSent (also Sunny's MARK_SHOW_QUOTE_SENT).
 */
export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const r = await markQuoteSent(id);
    if (r.kind === "not_found") return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });
    if (r.kind === "skipped") return NextResponse.json({ skipped: true });
    return NextResponse.json({ task: r.task, created: r.created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[shows quote-sent] error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
