import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ linkId: string }> };

// ── PATCH /api/red-films/reference-links/[linkId] ─────────────────────────
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { linkId } = await params;
  const body = await req.json().catch(() => ({}));

  const { data, error } = await supabase
    .from("red_films_reference_links")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", linkId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data });
}

// ── DELETE /api/red-films/reference-links/[linkId] ────────────────────────
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { linkId } = await params;

  const { error } = await supabase
    .from("red_films_reference_links")
    .delete()
    .eq("id", linkId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
