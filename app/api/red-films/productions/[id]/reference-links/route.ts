import { NextRequest, NextResponse } from "next/server";
import { addVideoReference } from "@/lib/writes/redfilms";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

// ── GET /api/red-films/productions/[id]/reference-links ───────────────────
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("red_films_reference_links")
    .select("*")
    .eq("production_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

// ── POST /api/red-films/productions/[id]/reference-links ──────────────────
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const { url, video_id, title, thumbnail_url, provider, notes } = body as {
    url: string;
    video_id: string;
    title?: string;
    thumbnail_url?: string;
    provider?: string;
    notes?: string;
  };

  if (!url || !video_id) {
    return NextResponse.json({ error: "url ו-video_id חובה" }, { status: 400 });
  }

  // shared writer (lib/writes/redfilms) — the same one Sunny's ADD_RF_VIDEO_REFERENCE uses
  let data: Record<string, unknown>;
  try { data = await addVideoReference(id, { url, video_id, title, thumbnail_url, provider, notes }); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 }); }
  return NextResponse.json({ link: data }, { status: 201 });
}
