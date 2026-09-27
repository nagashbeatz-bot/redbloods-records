/**
 * GET  /api/red-films/productions  — list all productions
 * POST /api/red-films/productions  — create a new production
 */
import { NextRequest, NextResponse } from "next/server";
import { createProduction, RfInputError } from "@/lib/writes/redfilms";
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
    // Shared writer (lib/writes/redfilms) — the same one Sunny's CREATE_PRODUCTION uses.
    let data: Record<string, unknown>;
    try { data = await createProduction(body); } catch (e) { if (e instanceof RfInputError) return NextResponse.json({ error: e.message }, { status: 400 }); throw e; }
    return NextResponse.json({ production: data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/productions]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
