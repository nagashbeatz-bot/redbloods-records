/**
 * PATCH /api/red-films/equipment/[id] — update fields or change status (owner-only)
 *
 * No DELETE route — physical delete is never exposed for equipment. "Removing
 * from inventory" is a status change (status="הוסר מהמלאי", removed_at=now());
 * restoring back to "קיים" resets removed_at to null. Each record represents
 * a TYPE+total quantity of equipment (not individual units) — removal always
 * affects the whole record/quantity, never a partial unit.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";

type Ctx = { params: Promise<{ id: string }> };

// Fields that may be patched — whitelist to prevent injection (mirrors the
// productions route's ALLOWED_FIELDS convention).
const ALLOWED_FIELDS = new Set([
  "name", "category", "quantity", "acquired_date",
  "purchase_price", "purchased_from", "serial_number", "notes", "added_by",
  "status",
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      patch[key] = body[key];
    }

    if ("name" in patch) {
      const name = String(patch.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "שם הציוד חובה" }, { status: 400 });
      patch.name = name;
    }
    if ("category" in patch) {
      const category = String(patch.category ?? "").trim();
      if (!category) return NextResponse.json({ error: "קטגוריה חובה" }, { status: 400 });
      patch.category = category;
    }
    if ("quantity" in patch) {
      const quantity = Number(patch.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: "כמות חייבת להיות גדולה מ-0" }, { status: 400 });
      }
      patch.quantity = quantity;
    }
    if ("purchase_price" in patch) {
      if (patch.purchase_price === "" || patch.purchase_price === null || patch.purchase_price === undefined) {
        patch.purchase_price = null;
      } else {
        const price = Number(patch.purchase_price);
        if (!Number.isFinite(price) || price < 0) {
          return NextResponse.json({ error: "מחיר קנייה לא תקין" }, { status: 400 });
        }
        patch.purchase_price = price;
      }
    }
    if ("status" in patch) {
      if (patch.status !== "קיים" && patch.status !== "הוסר מהמלאי") {
        return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
      }
      // Status is the sole driver of removed_at — set/reset together, always,
      // regardless of what else is in this same patch.
      patch.removed_at = patch.status === "הוסר מהמלאי" ? new Date().toISOString() : null;
    }

    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("red_films_equipment")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (e) {
    console.error("[PATCH /api/red-films/equipment/[id]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
