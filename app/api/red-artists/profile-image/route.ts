import { NextRequest, NextResponse } from "next/server";

// Isolated, demo-only profile-image upload for the Red Artists portal.
// Reuses the EXISTING Dropbox token only — no DB writes, no share tokens, no
// project coupling. Image is overwritten at a fixed path inside its own folder,
// so nothing here can affect project/Victor/social uploads.
export const maxDuration = 60;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const FOLDER = "/app/red-artists/shalev-tasama/profile-image";

/** ASCII-only serialization for the Dropbox-API-Arg header. */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });

    const ext = ALLOWED[file.type];
    if (!ext)                  return NextResponse.json({ error: "סוג קובץ לא נתמך — jpg / png / webp בלבד" }, { status: 415 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 5MB)" },           { status: 413 });

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const path   = `${FOLDER}/avatar.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const up = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "Content-Type":    "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({ path, mode: "overwrite", autorename: false, mute: true }),
      },
      body: buffer,
    });

    if (!up.ok) {
      const t = await up.text();
      let detail = t;
      try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
      console.error("[red-artists/profile-image] upload failed:", detail);
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 502 });
    }

    const uploaded  = (await up.json()) as { path_display?: string };
    const finalPath = uploaded.path_display ?? path;
    const url       = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

    return NextResponse.json({ ok: true, path: finalPath, url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/profile-image]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
