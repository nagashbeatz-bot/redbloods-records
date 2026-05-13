import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/calendar/create-event
 * Body: { summary, start, end }
 * Creates a Google Calendar event only after explicit user approval.
 */
export async function POST(req: NextRequest) {
  try {
    const { summary, start, end, artistEmail, publicDescription } = await req.json() as {
      summary: string; start: string; end: string;
      artistEmail?: string; publicDescription?: string;
    };

    if (!summary || !start || !end) {
      return NextResponse.json({ error: "summary / start / end חסרים" }, { status: 400 });
    }

    const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");

    if (!await isConnected()) {
      return NextResponse.json({ error: "not_connected" }, { status: 400 });
    }

    const event = await createCalendarEvent(summary, start, end,
      artistEmail
        ? { attendees: [{ email: artistEmail }], description: publicDescription }
        : undefined
    );
    return NextResponse.json({ ok: true, event, inviteSent: !!artistEmail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    const needsReauth =
      msg.includes("insufficient") ||
      msg.includes("forbidden") ||
      msg.includes("401") ||
      msg.includes("403");
    console.error("[calendar/create-event]", msg);
    return NextResponse.json(
      { error: msg, needsReauth },
      { status: needsReauth ? 403 : 500 }
    );
  }
}
