import { NextRequest, NextResponse } from "next/server";
import { deleteMixVersionWithFile } from "@/lib/writes/mix";
import { requireOwner } from "@/lib/require-auth";
import { updateMixVersion } from "@/lib/mix-versions-store";

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

    // Shared writer (lib/writes/mix): the stored file (best effort), then the row.
    await deleteMixVersionWithFile(versionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
