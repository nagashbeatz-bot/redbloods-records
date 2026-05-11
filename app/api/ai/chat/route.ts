import { NextRequest, NextResponse } from "next/server";
import { chatWithAgent } from "@/lib/ai-router";

export async function POST(req: NextRequest) {
  try {
    const { messages, projects } = await req.json();
    if (!messages || !projects) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Attach Google Calendar context when connected (best-effort, non-fatal)
    let calendarContext = "";
    try {
      const { isConnected, fetchTodayAndWeek, buildCalendarContext } = await import(
        "@/lib/google-calendar"
      );
      if (isConnected()) {
        const projectStubs = (projects as Array<{ id: string; name: string; artist: string }>).map(
          (p) => ({ id: p.id, name: p.name, artist: p.artist })
        );
        const { today, week } = await fetchTodayAndWeek(projectStubs);
        calendarContext = buildCalendarContext(today, week);
      }
    } catch {
      // Calendar unavailable — proceed without it
    }

    const result = await chatWithAgent(messages, projects, calendarContext);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
