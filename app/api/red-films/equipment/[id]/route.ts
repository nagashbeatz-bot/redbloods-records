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
import { updateEquipment } from "@/lib/writes/redfilms";
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
    const r = await updateEquipment(id, body); // shared writer (lib/writes/redfilms)
    if (r.kind === "bad") return NextResponse.json({ error: r.error }, { status: r.status });
    const data = r.item;
    return NextResponse.json({ item: data });
  } catch (e) {
    console.error("[PATCH /api/red-films/equipment/[id]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
