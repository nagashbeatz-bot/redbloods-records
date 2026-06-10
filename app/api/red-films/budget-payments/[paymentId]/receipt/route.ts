/**
 * POST /api/red-films/budget-payments/[paymentId]/receipt
 * FormData: { receipt: File }
 * Uploads receipt to Dropbox and updates the payment record.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

type Ctx = { params: Promise<{ paymentId: string }> };

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
}

const RECEIPT_EXTS = new Set([
  "jpg", "jpeg", "png", "webp", "heic", "gif",
  "pdf", "doc", "docx", "xls", "xlsx",
]);

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { paymentId } = await ctx.params;

    const form        = await req.formData();
    const receiptFile = form.get("receipt") as File | null;
    if (!receiptFile || receiptFile.size === 0) {
      return NextResponse.json({ error: "קובץ חסר" }, { status: 400 });
    }

    const ext = receiptFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (!RECEIPT_EXTS.has(ext)) {
      return NextResponse.json({ error: `סוג קובץ לא נתמך: .${ext}` }, { status: 400 });
    }

    // ── Look up payment → get production_id, amount, payment_date ────────────
    const { data: payment, error: pErr } = await supabase
      .from("red_films_budget_payments")
      .select("id, production_id, budget_item_id, amount, payment_date")
      .eq("id", paymentId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!payment) return NextResponse.json({ error: "תשלום לא נמצא" }, { status: 404 });

    // ── Look up item title ────────────────────────────────────────────────────
    let itemTitle = "תשלום";
    try {
      const { data: it } = await supabase
        .from("red_films_budget_items")
        .select("title")
        .eq("id", payment.budget_item_id)
        .maybeSingle();
      if (it?.title) itemTitle = it.title as string;
    } catch { /* non-fatal */ }

    const baseName    = `${sanitize(itemTitle)} - ${payment.amount} - ${payment.payment_date} - אסמכתא.${ext}`;
    const fileName    = baseName.slice(0, 200);
    const dropboxPath = `/Red Films/Productions/${payment.production_id}/receipts/${fileName}`;

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token  = await getDropboxToken();
    const buffer = Buffer.from(await receiptFile.arrayBuffer());

    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "Content-Type":    "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({
          path: dropboxPath, mode: "add", autorename: true, mute: false,
        }),
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      let detail = errText;
      try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded   = (await uploadRes.json()) as { path_display: string };
    const finalPath  = uploaded.path_display;

    let dropboxUrl = "";
    try {
      const shareRes = await fetch(
        "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: finalPath, settings: { requested_visibility: "public" } }),
        }
      );
      if (shareRes.ok) {
        const sd = (await shareRes.json()) as { url: string };
        dropboxUrl = sd.url.replace(/[?&]dl=0/, "?dl=1");
      } else {
        const sd = (await shareRes.json()) as {
          error?: { shared_link_already_exists?: { metadata?: { url?: string } } };
        };
        const existing = sd?.error?.shared_link_already_exists?.metadata?.url;
        dropboxUrl = existing
          ? existing.replace(/[?&]dl=0/, "?dl=1")
          : `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;
      }
    } catch {
      dropboxUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;
    }

    const { data, error } = await supabase
      .from("red_films_budget_payments")
      .update({
        receipt_file_name:    fileName,
        receipt_mime_type:    receiptFile.type ?? "",
        receipt_dropbox_path: finalPath,
        receipt_dropbox_url:  dropboxUrl,
        updated_at:           new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ payment: data });
  } catch (e) {
    console.error("[POST budget-payment/receipt]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
