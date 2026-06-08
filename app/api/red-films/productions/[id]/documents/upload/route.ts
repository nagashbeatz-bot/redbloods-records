/**
 * POST /api/red-films/productions/[id]/documents/upload
 * FormData: { file: File, fileType: string, notes?: string }
 * Uploads document to Dropbox with auto-generated display name, saves metadata to DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

const ALLOWED_EXTS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "rtf", "csv", "pages", "numbers", "key",
  "jpg", "jpeg", "png", "webp", "heic",
  "zip", "rar",
]);

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

function sanitizeSegment(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDisplayName(
  title: string,
  artistOrClient: string,
  fileType: string,
  ext: string
): string {
  const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const typeLabel = fileType === "אחר" || !fileType ? "מסמך" : fileType;
  const parts     = [sanitizeSegment(title)];
  if (artistOrClient) parts.push(sanitizeSegment(artistOrClient));
  parts.push(sanitizeSegment(typeLabel));
  parts.push(today);
  const base = parts.join(" - ");
  // Truncate to 120 chars to stay well under Dropbox's path limit
  return `${base.slice(0, 120)}.${ext}`;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;

    const formData = await req.formData();
    const file     = formData.get("file")     as File   | null;
    const fileType = formData.get("fileType") as string | null;
    const notes    = (formData.get("notes")   as string | null) ?? "";

    if (!file) {
      return NextResponse.json({ error: "קובץ חסר" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `סוג קובץ לא נתמך: .${ext}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "הקובץ גדול מדי — מקסימום 50MB" }, { status: 400 });
    }

    // ── Fetch production details for auto-naming ──────────────────────────────
    let prodTitle = "הפקה";
    let artistOrClient = "";
    try {
      const { data: prod } = await supabase
        .from("red_films_productions")
        .select("title, artist_name, client_name")
        .eq("id", productionId)
        .maybeSingle();
      if (prod) {
        prodTitle      = (prod.title as string)       || "הפקה";
        artistOrClient = (prod.artist_name as string) || (prod.client_name as string) || "";
      }
    } catch { /* non-fatal — fall back to generic name */ }

    const fileName   = buildDisplayName(prodTitle, artistOrClient, fileType ?? "אחר", ext);
    const dropboxPath = `/Red Films/Productions/${productionId}/documents/${fileName}`;

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    // ── 1. Upload to Dropbox ──────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
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
      console.error("[documents/upload] Dropbox error:", detail);
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded  = (await uploadRes.json()) as { path_display: string };
    const finalPath = uploaded.path_display;

    // ── 2. Share link (dl=1 for direct download/open) ────────────────────────
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
        if (existing) dropboxUrl = existing.replace(/[?&]dl=0/, "?dl=1");
      }
    } catch { /* non-fatal */ }

    if (!dropboxUrl) {
      dropboxUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;
    }

    // ── 3. Save metadata to DB ────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("red_films_documents")
      .insert({
        production_id: productionId,
        file_name:     fileName,
        file_type:     fileType ?? "אחר",
        mime_type:     file.type ?? "",
        dropbox_path:  finalPath,
        dropbox_url:   dropboxUrl,
        notes,
        created_at:    now,
        updated_at:    now,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ document: data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/productions/[id]/documents/upload]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
