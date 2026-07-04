import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess } from "@/lib/require-auth";
import { getVictorAvatar, setVictorAvatar, avatarDropboxPath } from "@/lib/victor-avatar";

/**
 * Victor profile avatar — owner OR Victor only (requireVictorAccess). Lives
 * under the victor-allowed API prefix. The Dropbox path is server-constant, so
 * this can only ever touch Victor's own avatar (no other vendor, no traversal).
 *   GET   → { …avatar, imageUrl }
 *   POST  (multipart: file [, zoom, posX, posY]) → upload source + save crop
 *   PATCH (json: zoom/posX/posY)                 → save crop only (no re-upload)
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const imageUrlFor = (a: { dropboxPath: string | null; updatedAt: string | null }) =>
  a.dropboxPath ? `/api/vendor/victor/avatar/image?v=${encodeURIComponent(a.updatedAt ?? "")}` : null;

export async function GET() {
  const denied = await requireVictorAccess(); if (denied) return denied;
  const a = await getVictorAvatar();
  return NextResponse.json({ ...a, imageUrl: imageUrlFor(a) });
}

export async function POST(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const fd = await req.formData();
    const file = fd.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "missing file" }, { status: 400 });
    const ext = EXT_BY_TYPE[(file.type || "").toLowerCase()];
    if (!ext) return NextResponse.json({ error: "images only (jpg/png/webp/gif)" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (max 8MB)" }, { status: 400 });

    const path = avatarDropboxPath(ext); // server-constant
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const buffer = Buffer.from(await file.arrayBuffer());
    const up = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }),
      },
      body: buffer,
    });
    if (!up.ok) { console.error("[victor/avatar] upload:", await up.text()); return NextResponse.json({ error: "upload failed" }, { status: 502 }); }

    // Best-effort: remove a previous source with a different extension.
    const prev = await getVictorAvatar();
    if (prev.dropboxPath && prev.dropboxPath !== path) {
      try {
        await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: prev.dropboxPath }),
        });
      } catch { /* non-fatal */ }
    }

    // Crop can come along (fresh upload from the editor) or reset to centered.
    const z = Number(fd.get("zoom")), px = Number(fd.get("posX")), py = Number(fd.get("posY"));
    const crop = (Number.isFinite(z) && Number.isFinite(px) && Number.isFinite(py))
      ? { zoom: clamp(z, 1, 5), posX: clamp(px, 0, 100), posY: clamp(py, 0, 100) }
      : { zoom: 1, posX: 50, posY: 50 };

    const saved = await setVictorAvatar({ dropboxPath: path, ext, ...crop });
    return NextResponse.json({ ok: true, ...saved, imageUrl: imageUrlFor(saved) });
  } catch (e) {
    console.error("[victor/avatar] POST", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { zoom?: unknown; posX?: unknown; posY?: unknown };
    const patch: Partial<{ zoom: number; posX: number; posY: number }> = {};
    if (Number.isFinite(Number(body.zoom))) patch.zoom = clamp(Number(body.zoom), 1, 5);
    if (Number.isFinite(Number(body.posX))) patch.posX = clamp(Number(body.posX), 0, 100);
    if (Number.isFinite(Number(body.posY))) patch.posY = clamp(Number(body.posY), 0, 100);
    const saved = await setVictorAvatar(patch);
    return NextResponse.json({ ok: true, ...saved, imageUrl: imageUrlFor(saved) });
  } catch (e) {
    console.error("[victor/avatar] PATCH", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
