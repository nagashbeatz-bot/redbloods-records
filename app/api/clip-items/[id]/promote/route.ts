import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/clip-items/[id]/promote
 * Creates a real transaction from a planning clip_item.
 * Sets clip_item.status = "הועבר לכספים" and stores the new transaction ID.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;

    // Fetch the clip_item
    const { data: item, error: fetchErr } = await supabase
      .from("clip_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !item) return NextResponse.json({ error: "clip item not found" }, { status: 404 });

    // Already promoted — return 409
    if (item.linked_transaction_id) {
      return NextResponse.json({ error: "already_promoted", linked_transaction_id: item.linked_transaction_id }, { status: 409 });
    }

    // Create transaction
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        project_id:     item.project_id,
        scope:          "project",
        type:           "expense",
        date:           null,
        description:    item.description || item.category || "הוצאת קליפ",
        artist:         "",
        amount:         item.amount,
        currency:       item.currency,
        payment_status: "לא שולם",
        payment_method: "",
        receipt_ref:    "",
        notes:          item.notes || "",
        category:       item.category || "קליפ",
        linked_session_id: "",
        expense_scope:  "קליפ",
      })
      .select()
      .single();

    if (txErr || !tx) return NextResponse.json({ error: txErr?.message ?? "failed to create transaction" }, { status: 500 });

    // Update clip_item: status + linked_transaction_id
    const { data: updatedItem, error: updateErr } = await supabase
      .from("clip_items")
      .update({
        status:                "הועבר לכספים",
        linked_transaction_id: tx.id,
        updated_at:            new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Bump project updated_at
    touchProject(item.project_id).catch(() => {});

    return NextResponse.json({ clipItem: updatedItem, transaction: tx });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
