import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/calendar/free-slots?duration=120&requiresBuffer=true&days=14
 */
export async function GET(req: NextRequest) {
  const duration       = parseInt(req.nextUrl.searchParams.get("duration") ?? "60", 10);
  const requiresBuffer = req.nextUrl.searchParams.get("requiresBuffer") === "true";
  const days           = Math.min(parseInt(req.nextUrl.searchParams.get("days") ?? "14", 10), 14);
  // maxDays: how many distinct working days to return slots for (default: 3)
  const maxDays        = Math.min(parseInt(req.nextUrl.searchParams.get("maxDays") ?? "3", 10), 14);

  if (!duration || duration < 5) {
    return NextResponse.json({ error: "duration לא תקין" }, { status: 400 });
  }

  try {
    const { isConnected, findFreeSlots } = await import("@/lib/google-calendar");
    if (!await isConnected()) return NextResponse.json({ error: "not_connected", slots: [] });

    const slots = await findFreeSlots(duration, requiresBuffer, days, 50, maxDays);
    return NextResponse.json({ slots });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    const needsReauth = msg.includes("insufficient") || msg.includes("forbidden") || msg.includes("401") || msg.includes("403");
    return NextResponse.json({ error: msg, slots: [], needsReauth }, { status: needsReauth ? 403 : 500 });
  }
}
