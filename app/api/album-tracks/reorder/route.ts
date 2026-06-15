import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await import("@/lib/supabase");
    const body = await req.json() as { tracks: { id: string; track_number: number }[] };
    const tracks = body?.tracks;

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return NextResponse.json({ error: "Invalid tracks array" }, { status: 400 });
    }

    // Pass 1: move all track_numbers to a safe range (+10000) to avoid unique constraint conflicts
    for (const t of tracks) {
      const { error } = await supabase
        .from("album_tracks")
        .update({ track_number: t.track_number + 10000 })
        .eq("id", t.id);
      if (error) throw new Error(error.message);
    }

    // Pass 2: set final values
    for (const t of tracks) {
      const { error } = await supabase
        .from("album_tracks")
        .update({ track_number: t.track_number })
        .eq("id", t.id);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[album-tracks/reorder]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
