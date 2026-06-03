import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/clip-items?projectId=xxx
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const { data, error } = await supabase
    .from("clip_items")
    .select("*")
    .eq("project_id", projectId)
    .neq("status", "בוטל")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clipItems: data ?? [] });
}

// POST /api/clip-items
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, category, description, amount, currency, notes } = body;

    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const { data, error } = await supabase
      .from("clip_items")
      .insert({
        project_id:  projectId,
        category:    category    || "",
        description: description || "",
        amount:      Number(amount) || 0,
        currency:    currency    || "₪",
        status:      "תכנון בלבד",
        notes:       notes       || "",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ clipItem: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
