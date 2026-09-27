import { NextRequest, NextResponse } from "next/server";
import { updateMeeting, deleteMeeting } from "@/lib/writes/meetings";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/meetings/[id] — shared writer (lib/writes/meetings): the Google event follows a date / time / place change.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const r = await updateMeeting(id, body);
    return NextResponse.json({ ok: true, meeting: r.meeting, calendarSynced: r.calendarSynced });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאה" }, { status: 500 });
  }
}

// DELETE /api/meetings/[id] — shared writer: the linked Google event is removed too (best-effort).
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const r = await deleteMeeting(id);
    return NextResponse.json({ ok: true, calendarRemoved: r.calendarRemoved });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאה" }, { status: 500 });
  }
}
