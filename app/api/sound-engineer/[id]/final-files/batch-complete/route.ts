import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { completeFinalFilesBatch } from "@/lib/final-files-batch-notify";

/** POST /api/sound-engineer/[id]/final-files/batch-complete — OWNER route.
 *  Called by the client right after its "Upload Final Files" upload loop
 *  finishes (every file terminal). Sends AT MOST one owner push summarizing
 *  the batch; idempotent, so a double-click/retry/StrictMode re-invoke never
 *  duplicates. Fires the SAME "Steven העלה..." push even though Owner is the
 *  one who clicked upload — a Steven-work upload is always a Steven upload for
 *  notification purposes (business rule, mirrors mix-version-upload.ts). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;

    const body = await req.json().catch(() => ({}));
    const batchId = typeof body?.batchId === "string" ? body.batchId : "";
    if (!batchId) return NextResponse.json({ ok: false, error: "batchId חסר" }, { status: 400 });

    await completeFinalFilesBatch(batchId, workId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Best-effort notification path — never surface a hard failure to the client.
    console.error("[sound-engineer/final-files/batch-complete]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true });
  }
}
