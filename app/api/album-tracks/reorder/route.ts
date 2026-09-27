import { NextRequest, NextResponse } from "next/server";
import { renumberAlbumTracks } from "@/lib/writes/worklog";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { tracks: { id: string; track_number: number }[] };
    const tracks = body?.tracks;

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return NextResponse.json({ error: "Invalid tracks array" }, { status: 400 });
    }

    // Pass 1: move all track_numbers to a safe range (+10000) to avoid unique constraint conflicts
    await renumberAlbumTracks(tracks); // shared writer (lib/writes/worklog)
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[album-tracks/reorder]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
