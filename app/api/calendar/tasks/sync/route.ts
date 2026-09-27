/**
 * POST /api/calendar/tasks/sync
 * Fetches completed Google Tasks and marks matching local tasks as "בוצע".
 * Only touches tasks that have a calendar_event_id (Google Task ID).
 * Never deletes — only updates status. Shared writer: lib/writes/tasks (also Sunny's SYNC_GOOGLE_TASKS_NOW).
 */
import { NextResponse } from "next/server";
import { syncCompletedGoogleTasks } from "@/lib/writes/tasks";

export async function POST() {
  try {
    return NextResponse.json(await syncCompletedGoogleTasks());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/calendar/tasks/sync]", msg);
    return NextResponse.json({ synced: 0, error: msg });
  }
}
