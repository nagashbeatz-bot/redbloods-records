import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { sendCycleReminder } from "@/lib/writes/label";

export const dynamic = "force-dynamic";

/**
 * Manual "send a financial-cycle reminder" — OWNER-ONLY, immediate, one-off (no cron, no scheduling, no idempotency
 * claim). Body: { toOwner?: boolean; toArtist?: boolean } — at least one true. The sender lives in the shared writer
 * lib/writes/label (sendCycleReminder) — the same one Sunny's SEND_CYCLE_REMINDER uses. A label artist without a
 * push role is reported as skipped, never a failure.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const r = await sendCycleReminder(id, body?.toOwner === true, body?.toArtist === true);
    if (r.kind === "not_found") return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });
    if (r.kind === "no_recipient") return NextResponse.json({ error: "יש לבחור לפחות נמען אחד" }, { status: 400 });
    if (r.kind === "no_cycle") return NextResponse.json({ error: "לא הוגדר מחזור כספי עבור אמן זה" }, { status: 400 });
    return NextResponse.json({ ok: true, ownerSent: r.ownerSent, artistSent: r.artistSent, artistSkipped: r.artistSkipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/balance/cycles/remind POST]", msg);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
