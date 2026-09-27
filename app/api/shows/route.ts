import { NextRequest, NextResponse } from "next/server";
import { listShows } from "@/lib/shows-store";
import { createShowRecord } from "@/lib/writes/shows";

export async function GET() {
  try {
    const shows = await listShows();
    // Fin-2: attach counted rehearsal costs per show so the list split matches
    // the open show panel (one batched query).
    const { getRehearsalCountedMap } = await import("@/lib/shows-finance-sync");
    const map = await getRehearsalCountedMap(shows.map((s) => s.id));
    const enriched = shows.map((s) => ({ ...s, rehearsalCounted: map[s.id] ?? 0 }));
    return NextResponse.json({ shows: enriched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "שם ההופעה חובה" }, { status: 400 });
    }

    // Shared writer (lib/writes/shows) — the same one Sunny's CREATE_SHOW uses.
    const r = await createShowRecord(body);
    return NextResponse.json(r.calendarWarning ? { show: r.show, calendarWarning: r.calendarWarning } : { show: r.show }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
