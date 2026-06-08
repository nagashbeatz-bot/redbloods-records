import { NextRequest, NextResponse } from "next/server";
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

  const { data, error } = await supabase
    .from("red_films_reference_links")
    .insert({
      production_id: id,
      url,
      video_id,
      provider:       provider      ?? "youtube",
      title:          title         ?? "",
      thumbnail_url:  thumbnail_url ?? `https://img.youtube.com/vi/${video_id}/hqdefault.jpg`,
      notes:          notes         ?? "",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data }, { status: 201 });
}
