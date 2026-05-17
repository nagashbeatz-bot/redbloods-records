import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/sessions/auto-mark
 *
 * Automatically marks "מתוכנן" sessions as "התקיים" when their end time has passed.
 *
 * Body: { clientNow: string }
 *   clientNow — local datetime string without timezone, e.g. "2026-05-15T14:01:00"
 *   Sent by the client so the comparison uses local time (avoids server timezone issues).
 *
 * Returns: { updated: number, ids: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const clientNow: string = body.clientNow ?? new Date().toISOString().slice(0, 19);

    // Fetch all "מתוכנן" sessions that have both a date and end_time
    const { data: rows, error } = await supabase
      .from("sessions")
      .select("id, date, end_time")
      .eq("status", "מתוכנן")
      .not("date", "is", null)
      .not("end_time", "is", null);

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) {
      return NextResponse.json({ updated: 0, ids: [] });
    }

    // Filter: sessions whose end datetime has passed (string comparison — same format, implicit local time)
    const toMark = rows.filter((s) => {
      const sessionEnd = `${s.date}T${s.end_time}:00`; // e.g. "2026-05-15T14:00:00"
      return sessionEnd < clientNow;
    });

    if (toMark.length === 0) {
      return NextResponse.json({ updated: 0, ids: [] });
    }

    const ids = toMark.map((s) => s.id as string);

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({ status: "התקיים" })
      .in("id", ids);

    if (updateErr) throw new Error(updateErr.message);

    return NextResponse.json({ updated: ids.length, ids });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions/auto-mark]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
