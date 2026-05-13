import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/calendar/check-slot
 * Body: { start: ISO, end: ISO, requiresBuffer: boolean }
 * Returns detailed validation for a manually-chosen time slot.
 */
export async function POST(req: NextRequest) {
  try {
    const { start, end, requiresBuffer } = await req.json();
    if (!start || !end) return NextResponse.json({ error: "start / end חסרים" }, { status: 400 });

    const { isConnected, checkManualSlot } = await import("@/lib/google-calendar");
    if (!await isConnected()) return NextResponse.json({ error: "not_connected" }, { status: 400 });

    const result = await checkManualSlot(start, end, !!requiresBuffer);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    const needsReauth = msg.includes("insufficient") || msg.includes("forbidden") || msg.includes("401") || msg.includes("403");
    return NextResponse.json({ error: msg, needsReauth }, { status: needsReauth ? 403 : 500 });
  }
}
