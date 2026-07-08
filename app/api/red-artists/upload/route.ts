import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { sanitizeFolder } from "@/lib/project-paths";

/**
 * POST /api/red-artists/upload
 *
 * OWNER ONLY. Uploads a single file into ONE of two server-owned artist folders,
 * chosen by an approved `kind` — the client NEVER sends a path.
 *
 *   kind=performance → /app/red-artists/shalev-tasama/performance-files  (audio only)
 *   kind=pressKit    → /app/red-artists/shalev-tasama/press-kit          (images / docs)
 *
 * No DB, no metadata, no share-token, no /Projects coupling. Reuses the existing
 * Dropbox token. Single-shot upload (no chunked in this phase). Dropbox auto-
 * creates the parent folder on first upload.
 */
export const maxDuration = 300;

const BASE = {
  performance: "/app/red-artists/shalev-tasama/performance-files",
  pressKit:    "/app/red-artists/shalev-tasama/press-kit",
} as const;
type Kind = keyof typeof BASE;

const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aif", "aiff"]);
const PRESS_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "pdf", "txt", "doc", "docx"]);
const MAX_BYTES = 140 * 1024 * 1024; // 140MB — single-shot ceiling (no chunked yet)

/** ASCII-only serialization for the Dropbox-API-Arg header (must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const form = await req.formData();
    const kind = form.get("kind") as string | null;
    const file = form.get("file") as File | null;

    if (kind !== "performance" && kind !== "pressKit") {
      return NextResponse.json({ error: "סוג העלאה לא תקין" }, { status: 400 });
    }
    if (!file) return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });

    const ext = extOf(file.name);
    const allowed = kind === "performance" ? AUDIO_EXT : PRESS_EXT;
    if (!allowed.has(ext)) {
      const msg = kind === "performance"
        ? "לקובץ הופעה ניתן להעלות אודיו בלבד (mp3, wav, m4a, ogg, flac, aif)"
        : "לחומרי יח״צ ניתן להעלות תמונות או מסמכים בלבד (jpg, png, webp, gif, pdf, txt, doc, docx)";
      return NextResponse.json({ error: msg }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 140MB)" }, { status: 413 });
    }

    // Server owns the folder; only the (sanitized) file NAME comes from the client.
    const safeName = sanitizeFolder(file.name) || `file.${ext}`;
    const path = `${BASE[kind as Kind]}/${safeName}`;

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "Content-Type":    "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({ path, mode: "add", autorename: true, mute: true }),
      },
      body: Buffer.from(await file.arrayBuffer()),
    });

    if (!res.ok) {
      const t = await res.text();
      let detail = t;
      try { detail = JSON.parse(t)?.error_summary ?? t; } catch { /* keep raw */ }
      console.error("[red-artists/upload]", detail);
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const j = (await res.json()) as { path_display?: string; name?: string };
    return NextResponse.json({ ok: true, kind, file: { name: j.name ?? safeName, path: j.path_display ?? path } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
