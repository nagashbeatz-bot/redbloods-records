import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getMixVersion, updateMixVersion, deleteMixVersion } from "@/lib/mix-versions-store";

/** PATCH /api/sound-engineer/versions/[versionId] — update status and/or label. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { versionId } = await params;
    const body = (await req.json()) as { status?: string; label?: string };
    const version = await updateMixVersion(versionId, body);
    return NextResponse.json({ ok: true, version });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/sound-engineer/versions/[versionId] — remove the Dropbox file, then
 * the row (mix_comments are removed by the FK cascade).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { versionId } = await params;

    const version = await getMixVersion(versionId);
    if (version?.dropboxPath) {
      try {
        const { getDropboxToken } = await import("@/lib/dropbox-token");
        const token = await getDropboxToken();
        await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: version.dropboxPath }),
        });
      } catch { /* best-effort — still remove the DB row */ }
    }

    await deleteMixVersion(versionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
