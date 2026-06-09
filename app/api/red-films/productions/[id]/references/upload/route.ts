/**
 * POST /api/red-films/productions/[id]/references/upload
 * FormData: { file: File }
 * Uploads image to Dropbox, creates share link, saves metadata to DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"]);

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;

    // ── Validate input first (before touching Dropbox) ────────────────────────
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const tag  = (formData.get("tag") as string | null)?.trim() || "כללי";

    if (!file) {
      return NextResponse.json({ error: "קובץ חסר" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `סוג קובץ לא נתמך: .${ext} — יש להעלות תמונה (JPG, PNG, WEBP, GIF)` },
        { status: 400 }
      );
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "הקובץ גדול מדי — מקסימום 20MB" }, { status: 400 });
    }

    // ── Get Dropbox token (after validation) ──────────────────────────────────
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    // Sanitize filename + make unique
    const ts = Date.now();
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const fileName = `${ts}_${safeName}`;
    const dropboxPath = `/Red Films/Productions/${productionId}/references/${fileName}`;

    // ── 1. Upload to Dropbox ──────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "Content-Type":    "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({
          path:       dropboxPath,
          mode:       "add",
          autorename: true,
          mute:       false,
        }),
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      let detail = errText;
      try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
      console.error("[references/upload] Dropbox upload error:", detail);
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded = (await uploadRes.json()) as { path_display: string };
    const finalPath = uploaded.path_display;

    // ── 2. Generate thumbnail → upload to Dropbox → get CDN URL ─────────────
    // We store a small thumbnail CDN URL in dropbox_url so the grid loads fast
    // without a server proxy. The full image stays at dropbox_path / stream route.
    let dropboxUrl = "";
    try {
      // 2a. Get thumbnail binary from Dropbox (w640h480 JPEG)
      const thumbRes = await fetch("https://content.dropboxapi.com/2/files/get_thumbnail", {
        method: "POST",
        headers: {
          Authorization:     `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxArg({
            path:   finalPath,
            format: { ".tag": "jpeg" },
            size:   { ".tag": "w640h480" },
            mode:   { ".tag": "fitone_way" },
          }),
        },
      });

      if (thumbRes.ok) {
        const thumbBuffer = await thumbRes.arrayBuffer();
        const thumbFileName = `${ts}_thumb_${safeName.replace(/\.[^.]+$/, "")}.jpg`;
        const thumbPath = `/Red Films/Productions/${productionId}/references/.thumbs/${thumbFileName}`;

        // 2b. Upload thumbnail to Dropbox
        const thumbUploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
          method: "POST",
          headers: {
            Authorization:     `Bearer ${token}`,
            "Content-Type":    "application/octet-stream",
            "Dropbox-API-Arg": dropboxArg({ path: thumbPath, mode: "add", autorename: true, mute: true }),
          },
          body: thumbBuffer,
        });

        if (thumbUploadRes.ok) {
          const thumbUploaded = (await thumbUploadRes.json()) as { path_display: string };

          // 2c. Get share link for thumbnail → convert to CDN URL
          const thumbShareRes = await fetch(
            "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ path: thumbUploaded.path_display, settings: { requested_visibility: "public" } }),
            }
          );
          let rawThumbUrl = "";
          if (thumbShareRes.ok) {
            rawThumbUrl = ((await thumbShareRes.json()) as { url: string }).url;
          } else {
            const sd = (await thumbShareRes.json()) as { error?: { shared_link_already_exists?: { metadata?: { url?: string } } } };
            rawThumbUrl = sd?.error?.shared_link_already_exists?.metadata?.url ?? "";
          }
          if (rawThumbUrl) {
            dropboxUrl = rawThumbUrl
              .replace("www.dropbox.com", "dl.dropboxusercontent.com")
              .replace(/[?&]dl=0/, "");
          }
        }
      }
    } catch { /* non-fatal — fall through to stream fallback */ }

    // Fallback: no thumbnail → use stream route (served via proxy)
    if (!dropboxUrl) {
      dropboxUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;
    }

    // ── 3. Save metadata to DB ────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("red_films_reference_images")
      .insert({
        production_id: productionId,
        file_name:     fileName,
        dropbox_path:  finalPath,
        dropbox_url:   dropboxUrl,
        tag,
        sort_order:    0,
        created_at:    now,
        updated_at:    now,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ reference: data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/red-films/productions/[id]/references/upload]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
