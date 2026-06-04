import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * DELETE /api/calendar/tasks/[id]
 * Deletes a Google Task from the user's default task list.
 * The [id] segment is the Google Task ID (stored as calendar_event_id).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar");

    if (!await isConnected()) {
      return NextResponse.json({ error: "not_connected" }, { status: 400 });
    }

    await deleteGoogleTask(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[DELETE /api/calendar/tasks]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
