/**
 * GET    /api/agent/memory?category=vendor — list memory entries
 * POST   /api/agent/memory — create / upsert entry
 * DELETE /api/agent/memory?key=<key> — delete entry
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { BusinessMemoryEntry } from "@/lib/types";

function mapRow(r: Record<string, unknown>): BusinessMemoryEntry {
  return {
    key:       r.key       as string,
    value:     r.value     as string,
    category:  r.category  as string,
    relatedId: (r.related_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  let q = supabase.from("business_memory").select("*").order("updated_at", { ascending: false });
  if (category) q = q.eq("category", category);
  const { data } = await q;
  return NextResponse.json({ entries: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.key || !body.value) {
      return NextResponse.json({ error: "key and value required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("business_memory")
      .upsert(
        {
          key:        body.key,
          value:      body.value,
          category:   body.category  ?? "general",
          related_id: body.relatedId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      )
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ entry: mapRow(data as Record<string, unknown>) });
  } catch (e) {
    console.error("[agent/memory] POST error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  await supabase.from("business_memory").delete().eq("key", key);
  return NextResponse.json({ ok: true });
}
