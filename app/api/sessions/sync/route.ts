import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/sessions/sync?projectId=xxx
 *
 * For every session that has a calendar_event_id, checks whether the Google
 * Calendar event still exists. Sessions whose event was deleted from the
 * calendar are automatically removed from Supabase so the drawer stays in sync.
 *
 * Returns { deleted: number, checked: number }
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    }

    // Fetch sessions that have a linked calendar event
    const { data: rows, error } = await supabase
      .from("sessions")
      .select("id, calendar_event_id")
      .eq("project_id", projectId)
      .not("calendar_event_id", "is", null);

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) {
      return NextResponse.json({ deleted: 0, checked: 0 });
    }

    // Check Google Calendar availability
    let calendarAvailable = false;
    let calendarEventExists: ((id: string) => Promise<boolean>) | null = null;

    try {
      const { isConnected, calendarEventExists: checkExists } = await import("@/lib/google-calendar");
      if (await isConnected()) {
        calendarAvailable = true;
        calendarEventExists = checkExists;
      }
    } catch {
      // Google Calendar not configured — skip sync
    }

    if (!calendarAvailable || !calendarEventExists) {
      return NextResponse.json({ deleted: 0, checked: 0, skipped: "calendar_not_connected" });
    }

    // Check each session's event — in parallel (max 5 at a time)
    const toDelete: string[] = [];
    const chunk = 5;

    for (let i = 0; i < rows.length; i += chunk) {
      const batch = rows.slice(i, i + chunk);
      const results = await Promise.all(
        batch.map(async (row) => {
          const exists = await calendarEventExists!(row.calendar_event_id as string);
          return { id: row.id as string, exists };
        })
      );
      for (const r of results) {
        if (!r.exists) toDelete.push(r.id);
      }
    }

    // Delete orphaned sessions from Supabase
    if (toDelete.length > 0) {
      await supabase.from("sessions").delete().in("id", toDelete);
    }

    return NextResponse.json({ deleted: toDelete.length, checked: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions/sync]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
