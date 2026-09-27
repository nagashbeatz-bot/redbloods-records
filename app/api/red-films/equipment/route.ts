/**
 * GET  /api/red-films/equipment  — list all equipment (owner-only)
 * POST /api/red-films/equipment  — add a new equipment item (owner-only)
 */
import { NextRequest, NextResponse } from "next/server";
import { createEquipment } from "@/lib/writes/redfilms";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";

export async function GET(_req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { data, error } = await supabase
      .from("red_films_equipment")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ equipment: data ?? [] });
  } catch (e) {
    console.error("[GET /api/red-films/equipment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = await req.json();
    const r = await createEquipment(body); // shared writer (lib/writes/redfilms)
    if (r.kind === "bad") return NextResponse.json({ error: r.error }, { status: r.status });
    const data = r.item;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/equipment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
