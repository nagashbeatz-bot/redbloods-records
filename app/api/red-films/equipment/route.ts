/**
 * GET  /api/red-films/equipment  — list all equipment (owner-only)
 * POST /api/red-films/equipment  — add a new equipment item (owner-only)
 */
import { NextRequest, NextResponse } from "next/server";
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
    const { name, category } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "שם הציוד חובה" }, { status: 400 });
    }
    if (!category || typeof category !== "string" || !category.trim()) {
      return NextResponse.json({ error: "קטגוריה חובה" }, { status: 400 });
    }
    const quantity = Number(body.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "כמות חייבת להיות גדולה מ-0" }, { status: 400 });
    }
    let purchasePrice: number | null = null;
    if (body.purchase_price !== undefined && body.purchase_price !== null && body.purchase_price !== "") {
      purchasePrice = Number(body.purchase_price);
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return NextResponse.json({ error: "מחיר קנייה לא תקין" }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const insertRow: Record<string, unknown> = {
      name: name.trim(),
      category: category.trim(),
      quantity,
      purchase_price: purchasePrice,
      purchased_from: body.purchased_from?.trim() || null,
      serial_number: body.serial_number?.trim() || null,
      notes: body.notes?.trim() || null,
      added_by: body.added_by?.trim() || "NagashBeatz",
      created_at: now,
      updated_at: now,
    };
    if (body.acquired_date) insertRow.acquired_date = body.acquired_date;

    const { data, error } = await supabase
      .from("red_films_equipment")
      .insert(insertRow)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/equipment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
