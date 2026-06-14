/**
 * POST /api/calendar/tasks/sync
 * Fetches completed Google Tasks and marks matching local tasks as "בוצע".
 * Only touches tasks that have a calendar_event_id (Google Task ID).
 * Never deletes — only updates status.
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST() {
  try {
    const { isConnected, listCompletedGoogleTaskIds } = await import("@/lib/google-calendar");

    if (!await isConnected()) {
      return NextResponse.json({ synced: 0, skipped: "not_connected" });
    }

    // Fetch all completed Google Task IDs
    const completedIds = await listCompletedGoogleTaskIds();
    if (completedIds.size === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Find local open tasks that have a google task id
    const { data: openTasks, error } = await supabase
      .from("tasks")
      .select("id, calendar_event_id")
      .eq("status", "פתוח")
      .not("calendar_event_id", "is", null);

    if (error) throw new Error(error.message);

    const toUpdate = (openTasks ?? []).filter(
      (t: { id: string; calendar_event_id: string | null }) =>
        t.calendar_event_id && completedIds.has(t.calendar_event_id)
    );

    if (toUpdate.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    const ids = toUpdate.map((t: { id: string }) => t.id);
    const { error: updErr } = await supabase
      .from("tasks")
      .update({ status: "בוצע", updated_at: new Date().toISOString() })
      .in("id", ids);

    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ synced: toUpdate.length });
  } catch (err) {
    console.error("[POST /api/calendar/tasks/sync]", err);
    return NextResponse.json({ synced: 0, error: "sync_failed" });
  }
}
