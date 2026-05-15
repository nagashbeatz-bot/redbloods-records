import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── PATCH /api/sessions/[id] — update a session ──────────────────────────────
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { date, startTime, endTime, status, sessionType, notes } = body;

    const patch: Record<string, unknown> = {};
    if (date        !== undefined) patch.date         = date        || null;
    if (startTime   !== undefined) patch.start_time   = startTime   || null;
    if (endTime     !== undefined) patch.end_time     = endTime     || null;
    if (status      !== undefined) patch.status       = status;
    if (sessionType !== undefined) patch.session_type = sessionType;
    if (notes       !== undefined) patch.notes        = notes;

    const { data, error } = await supabase
      .from("sessions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ session: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions PATCH id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE /api/sessions/[id] ─────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions DELETE id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
