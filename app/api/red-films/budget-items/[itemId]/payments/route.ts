/**
 * GET  /api/red-films/budget-items/[itemId]/payments — list payments for item
 * POST /api/red-films/budget-items/[itemId]/payments — create payment (FormData)
 *      FormData fields: amount, payment_date, payment_method, notes
 *      FormData file:   receipt (optional — uploaded to Dropbox /receipts/)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

type Ctx = { params: Promise<{ itemId: string }> };

// ── helpers ───────────────────────────────────────────────────────────────────

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

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

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

    // ── Optional: upload receipt to Dropbox ───────────────────────────────────
    let receiptFileName    = "";
    let receiptMimeType    = "";
    let receiptDropboxPath = "";
    let receiptDropboxUrl  = "";

    if (receiptFile && receiptFile.size > 0) {
      const ext = receiptFile.name.split(".").pop()?.toLowerCase() ?? "";
      if (!RECEIPT_EXTS.has(ext)) {
        return NextResponse.json({ error: `סוג קובץ לא נתמך לאסמכתא: .${ext}` }, { status: 400 });
      }
      if (receiptFile.size > MAX_SIZE) {
        return NextResponse.json({ error: "קובץ גדול מדי — מקסימום 20MB" }, { status: 400 });
      }

      // Build file name: "{title} - {amount} - {date} - אסמכתא.{ext}"
      const baseName = `${sanitize(itemTitle)} - ${amount} - ${paymentDate} - אסמכתא.${ext}`;
      receiptFileName    = baseName.slice(0, 200);
      receiptDropboxPath = `/Red Films/Productions/${productionId}/receipts/${receiptFileName}`;
      receiptMimeType    = receiptFile.type ?? "";

      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token  = await getDropboxToken();
      const buffer = Buffer.from(await receiptFile.arrayBuffer());

      const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization:     `Bearer ${token}`,
          "Content-Type":    "application/octet-stream",
          "Dropbox-API-Arg": dropboxArg({
            path: receiptDropboxPath, mode: "add", autorename: true, mute: false,
          }),
        },
        body: buffer,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error("[budget-payment receipt] Dropbox upload error:", errText);
        // Non-fatal — create payment without receipt
        receiptFileName = receiptDropboxPath = receiptDropboxUrl = receiptMimeType = "";
      } else {
        const uploaded  = (await uploadRes.json()) as { path_display: string };
        receiptDropboxPath = uploaded.path_display;

        // Create share link
        try {
          const shareRes = await fetch(
            "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ path: receiptDropboxPath, settings: { requested_visibility: "public" } }),
            }
          );
          if (shareRes.ok) {
            const sd = (await shareRes.json()) as { url: string };
            receiptDropboxUrl = sd.url.replace(/[?&]dl=0/, "?dl=1");
          } else {
            const sd = (await shareRes.json()) as {
              error?: { shared_link_already_exists?: { metadata?: { url?: string } } };
            };
            const existing = sd?.error?.shared_link_already_exists?.metadata?.url;
            receiptDropboxUrl = existing
              ? existing.replace(/[?&]dl=0/, "?dl=1")
              : `/api/dropbox/stream?path=${encodeURIComponent(receiptDropboxPath)}`;
          }
        } catch {
          receiptDropboxUrl = `/api/dropbox/stream?path=${encodeURIComponent(receiptDropboxPath)}`;
        }
      }
    }

    // ── Insert payment ────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("red_films_budget_payments")
      .insert({
        production_id:        productionId,
        budget_item_id:       itemId,
        amount,
        payment_date:         paymentDate,
        payment_method:       paymentMethod,
        notes,
        receipt_file_name:    receiptFileName,
        receipt_mime_type:    receiptMimeType,
        receipt_dropbox_path: receiptDropboxPath,
        receipt_dropbox_url:  receiptDropboxUrl,
        created_at:           now,
        updated_at:           now,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ payment: data }, { status: 201 });
  } catch (e) {
    console.error("[POST budget-item payment]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
