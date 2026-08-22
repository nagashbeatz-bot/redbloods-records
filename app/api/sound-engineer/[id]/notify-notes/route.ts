import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getSoundEngineerWork, stevenDisplayName } from "@/lib/sound-engineer-store";
import { notifyStevenMixNotes } from "@/lib/steven-notes-notify";
import { resolveMixLineContext } from "@/lib/riddim-work";

/**
 * POST /api/sound-engineer/[id]/notify-notes
 *
 * OWNER ONLY. Fired ONLY by the purple "Send notes" button in a work's modal —
 * never automatically (not on load, refresh, comment-add, upload, or edit).
 * Takes just the workId; the server loads the work and builds the displayName
 * itself (workTitle || projectName) so the client can't spoof the text. Sends an
 * IDENTICAL "New mix notes" push to owner + Steven. Repeatable (no dedup): the
 * owner sends feedback whenever ready.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;

    const work = await getSoundEngineerWork(id);
    if (!work) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });

    // The client may name WHICH version the notes are about, but only by id —
    // the display text is resolved server-side from mix_versions → mix_targets,
    // so the same "can't spoof the text" rule the displayName follows holds here
    // too. Ignored (null) on any non-riddim work and on an unassigned version.
    const body = await req.json().catch(() => ({})) as { mixVersionId?: string };
    const line = await resolveMixLineContext(work.id, body.mixVersionId);

    // work.projectId is already loaded (canonical sound_engineer_work.project_id);
    // no extra query. null for standalone work → owner stays on the url fallback.
    const result = await notifyStevenMixNotes({
      id: work.id,
      displayName: stevenDisplayName(work),
      projectId: work.projectId ?? null,
    }, line);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/notify-notes]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
