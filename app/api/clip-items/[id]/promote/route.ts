import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { touchProject } from "@/lib/projects-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/clip-items/[id]/promote
 * Creates a real transaction from a planning clip_item.
 * Sets clip_item.status = "הועבר לכספים" and stores the new transaction ID.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { date } = body as { date?: string };
    if (!date) return NextResponse.json({ error: "תאריך חובה" }, { status: 400 });

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
        date:           date || null,
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

    // Delete clip_item — it's now represented by the transaction in finance
    await supabase.from("clip_items").delete().eq("id", id);

    // Bump project updated_at
    touchProject(item.project_id).catch(() => {});

    return NextResponse.json({ deleted: true, transaction: tx });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "שגיאת שרת" }, { status: 500 });
  }
}
