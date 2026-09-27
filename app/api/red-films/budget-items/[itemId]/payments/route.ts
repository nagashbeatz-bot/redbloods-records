/**
 * GET  /api/red-films/budget-items/[itemId]/payments — list payments for item
 * POST /api/red-films/budget-items/[itemId]/payments — create payment (FormData)
 *      FormData fields: amount, payment_date, payment_method, notes
 *      FormData file:   receipt (optional — uploaded to Dropbox /receipts/)
 */
import { NextRequest, NextResponse } from "next/server";
import { insertBudgetPayment } from "@/lib/writes/redfilms";
import { receiptForNewPayment } from "@/lib/writes/uploads";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

type Ctx = { params: Promise<{ itemId: string }> };

// ── helpers ───────────────────────────────────────────────────────────────────

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;
    const { data, error } = await supabase
      .from("red_films_budget_payments")
      .select("*")
      .eq("budget_item_id", itemId)
      .order("payment_date", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ payments: data ?? [] });
  } catch (e) {
    console.error("[GET budget-item payments]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;

    // ── Parse FormData ────────────────────────────────────────────────────────
    const form          = await req.formData();
    const amount        = Number(form.get("amount"))        || 0;
    const paymentDate   = (form.get("payment_date")  as string) || new Date().toISOString().slice(0, 10);
    const paymentMethod = (form.get("payment_method") as string) ?? "";
    const notes         = (form.get("notes")         as string) ?? "";
    const receiptFile   = form.get("receipt") as File | null;

    if (amount <= 0) {
      return NextResponse.json({ error: "סכום חייב להיות גדול מ-0" }, { status: 400 });
    }

    // ── Look up item to get production_id + title ─────────────────────────────
    const { data: item, error: itemErr } = await supabase
      .from("red_films_budget_items")
      .select("id, production_id, title")
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) return NextResponse.json({ error: "פריט תקציב לא נמצא" }, { status: 404 });

    const productionId = item.production_id as string;
    const itemTitle    = (item.title as string) || "תשלום";

    // ── Optional receipt — shared writer (lib/writes/uploads); a storage error is non-fatal (payment without receipt) ──
    let receipt: { fileName: string; mimeType: string; dropboxPath: string; dropboxUrl: string } | undefined;
    if (receiptFile && receiptFile.size > 0) {
      const rr = await receiptForNewPayment(productionId, itemTitle, amount, paymentDate, receiptFile);
      if (!rr.ok) return NextResponse.json({ error: rr.error }, { status: rr.status });
      receipt = rr.receipt;
    }

    // ── Insert payment — shared writer (lib/writes/redfilms), the same one Sunny's RECORD_RF_BUDGET_PAYMENT uses ──
    const ins = await insertBudgetPayment(itemId, { amount, paymentDate, paymentMethod, notes, receipt });
    if (ins.kind === "not_found") return NextResponse.json({ error: "פריט תקציב לא נמצא" }, { status: 404 });
    const data = ins.payment;

    return NextResponse.json({ payment: data }, { status: 201 });
  } catch (e) {
    console.error("[POST budget-item payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
