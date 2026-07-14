import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";

// Profile-image storage for the Red Artists portal — Dropbox is the SOURCE OF
// TRUTH (localStorage on the client is a cache only), so re-editing works from
// any device/browser. Owner-only. Reuses the EXISTING Dropbox token — no DB, no
// share tokens, no project coupling. The server owns ALL paths inside one fixed
// folder; the client never sends a path.
//
//   original.<ext>  — the untouched picked image (for re-editing from the source)
//   avatar.jpg      — the cropped image shown in the portal
//   editor.json     — last crop metadata { zoom, position, originalExt, ... }
export const maxDuration = 60;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};
// The real infrastructure ceiling = Dropbox single-request /files/upload (150MB);
// the proxy body limit (512MB) is looser, so Dropbox is binding. The old 5MB cap
// was an arbitrary block that rejected ordinary phone photos.
const MAX_BYTES = 150 * 1024 * 1024; // 150MB
const MAX_LABEL = "150MB";
// Server-owned folder + filenames — NEVER derived from client input.
const FOLDER      = "/app/red-artists/shalev-tasama/profile-image";
const AVATAR_PATH = `${FOLDER}/avatar.jpg`; // editor always exports JPEG
const EDITOR_PATH = `${FOLDER}/editor.json`;

/** ASCII-only serialization for the Dropbox-API-Arg header. */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

async function dbxUpload(token: string, path: string, body: Blob): Promise<string> {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization:     `Bearer ${token}`,
      "Content-Type":    "application/octet-stream",
      "Dropbox-API-Arg": dropboxArg({ path, mode: "overwrite", autorename: false, mute: true }),
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    let detail = t;
    try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
    throw new Error(`Dropbox: ${detail}`);
  }
  const j = (await res.json()) as { path_display?: string };
  return j.path_display ?? path;
}

/** Download a small text file (editor.json). Returns null if it doesn't exist. */
async function dbxDownloadText(token: string, path: string): Promise<string | null> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization:     `Bearer ${token}`,
      "Dropbox-API-Arg": dropboxArg({ path }),
    },
  });
  if (!res.ok) return null; // 409 path/not_found (or anything else) → treat as absent
  return await res.text();
}

type EditorMeta = {
  zoom: number;
  position: { x: number; y: number };
  originalExt?: string;
  originalFileName?: string;
  updatedAt?: string;
};

function parseEditor(raw: string | null): EditorMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as EditorMeta;
    if (typeof v?.zoom === "number" && typeof v?.position?.x === "number" && typeof v?.position?.y === "number") {
      return v;
    }
  } catch { /* ignore */ }
  return null;
}

function streamUrl(path: string): string {
  // Scoped portal stream (owner|shalev, restricted to Shalev's folder tree) — the
  // raw /api/dropbox/stream is blocked for the shalev role.
  return `/api/red-artists/stream?path=${encodeURIComponent(path)}`;
}

// ── GET: original image + last crop (source of truth for re-editing) ─────────────
export async function GET() {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const meta = parseEditor(await dbxDownloadText(token, EDITOR_PATH));
    // Only expose the original when we know its real extension (avoids a 404).
    const originalPath = meta?.originalExt ? `${FOLDER}/original.${meta.originalExt}` : null;

    return NextResponse.json({
      ok: true,
      original: originalPath ? { path: originalPath, url: streamUrl(originalPath) } : null,
      editor: meta ? { zoom: meta.zoom, position: meta.position, updatedAt: meta.updatedAt ?? null } : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/profile-image GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ── POST: save avatar (always) + original (only when provided) + editor.json ─────
//   form fields: avatar (File, required), original (File, optional — new image),
//                zoom, posX, posY (numbers), originalFileName (optional string)
export async function POST(req: NextRequest) {
  const denied = await requireShalevAccess();
  if (denied) return denied;
  try {
    const form = await req.formData();

    const avatar = form.get("avatar") as File | null;
    if (!avatar) return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });
    const avatarExt = ALLOWED[avatar.type];
    if (!avatarExt)               return NextResponse.json({ error: "סוג קובץ לא נתמך — jpg / png / webp בלבד" }, { status: 415 });
    if (avatar.size > MAX_BYTES)  return NextResponse.json({ error: `הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${MAX_LABEL})` }, { status: 413 });

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    // avatar (fixed name/ext — server-owned path). File is a Blob → send as-is.
    const avatarPath = await dbxUpload(token, AVATAR_PATH, avatar);

    // original (optional — only on a new / replaced image)
    const original = form.get("original") as File | null;
    let originalExt: string | undefined;
    if (original) {
      originalExt = ALLOWED[original.type];
      if (!originalExt)               return NextResponse.json({ error: "סוג קובץ לא נתמך — jpg / png / webp בלבד" }, { status: 415 });
      if (original.size > MAX_BYTES)  return NextResponse.json({ error: `הקובץ גדול מהמגבלה שהשרת מאפשר (מקסימום ${MAX_LABEL})` }, { status: 413 });
      await dbxUpload(token, `${FOLDER}/original.${originalExt}`, original);
    } else {
      // Re-crop of the existing image → keep the original untouched; preserve its
      // extension from the previous editor.json so GET still finds it.
      originalExt = parseEditor(await dbxDownloadText(token, EDITOR_PATH))?.originalExt;
    }

    // editor.json (last crop) — always overwritten
    const zoom = Number(form.get("zoom"));
    const posX = Number(form.get("posX"));
    const posY = Number(form.get("posY"));
    const originalFileName = (form.get("originalFileName") as string | null) || undefined;
    const meta: EditorMeta = {
      zoom:     Number.isFinite(zoom) ? zoom : 1,
      position: { x: Number.isFinite(posX) ? posX : 0, y: Number.isFinite(posY) ? posY : 0 },
      ...(originalExt      ? { originalExt } : {}),
      ...(originalFileName ? { originalFileName } : {}),
      updatedAt: new Date().toISOString(),
    };
    await dbxUpload(token, EDITOR_PATH, new Blob([JSON.stringify(meta)], { type: "application/json" }));

    return NextResponse.json({ ok: true, path: avatarPath, url: streamUrl(avatarPath) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/profile-image POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
