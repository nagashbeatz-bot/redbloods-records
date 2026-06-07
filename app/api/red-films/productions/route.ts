/**
 * GET  /api/red-films/productions  — list all productions
 * POST /api/red-films/productions  — create a new production
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest) {
  try {
    const { data, error } = await supabase
      .from("red_films_productions")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ productions: data ?? [] });
  } catch (e) {
    console.error("[GET /api/red-films/productions]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "שם ההפקה חובה" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("red_films_productions")
      .insert({
        title:              title.trim(),
        production_type:    body.production_type    ?? "קליפ",
        status:             "רעיון",
        artist_name:        body.artist_name        ?? "",
        client_id:          body.client_id          ?? null,
        client_name:        body.client_name        ?? "",
        photographer_name:  body.photographer_name  ?? "יאיר",
        client_source:      "פנימי - לייבל",
        collection_status:  "לא רלוונטי",
        created_at:         now,
        updated_at:         now,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ production: data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/productions]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
