import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/calendar/create-task
 * Body: { title, due, notes? }
 * Creates a Google Task in the default task list (appears in Google Calendar).
 */
export async function POST(req: NextRequest) {
  try {
    const { title, due, notes } = await req.json() as {
      title: string;
      due: string;      // YYYY-MM-DD
      notes?: string;
    };

    if (!title || !due) {
      return NextResponse.json({ error: "title / due חסרים" }, { status: 400 });
    }

    const { isConnected, createGoogleTask } = await import("@/lib/google-calendar");

    if (!await isConnected()) {
      return NextResponse.json({ error: "not_connected" }, { status: 400 });
    }

    const task = await createGoogleTask(title, due, notes);
    return NextResponse.json({ ok: true, task });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    const needsReauth =
      msg.includes("insufficient") ||
      msg.includes("forbidden") ||
      msg.includes("401") ||
      msg.includes("403");
    console.error("[calendar/create-task]", msg);
    return NextResponse.json(
      { error: msg, needsReauth },
      { status: needsReauth ? 403 : 500 }
    );
  }
}
