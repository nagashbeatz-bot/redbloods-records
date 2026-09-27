import { NextRequest, NextResponse } from "next/server";
import { createAlbumTrack } from "@/lib/writes/worklog";
import { supabase } from "@/lib/supabase";
import type { AlbumTrack } from "@/lib/types";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "חסר projectId" }, { status: 400 });

  const { data, error } = await supabase
    .from("album_tracks")
    .select("*")
    .eq("project_id", projectId)
    .order("track_number", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as AlbumTrack[]);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    project_id:   string;
    track_number: number;
    title:        string;
    status?:      string;
    mix_status?:  string;
    master_status?: string;
    notes?:       string;
  };

  if (!body.project_id || !body.title || body.track_number == null) {
    return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
  }
  let data: Record<string, unknown>;
  try { data = await createAlbumTrack(body); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 }); }
  return NextResponse.json(data as unknown as AlbumTrack, { status: 201 });
}
