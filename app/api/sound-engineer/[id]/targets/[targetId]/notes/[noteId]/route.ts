import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { assertTargetOnRiddimWork } from "@/lib/riddim-work";
import { getMixTargetNote, updateMixTargetNote, deleteMixTargetNote } from "@/lib/mix-target-notes-store";

/**
 * Edit / resolve / delete one pre-mix note. OWNER ONLY — Steven reads these,
 * he never writes them.
 *
 * Three checks before anything is touched, in order: the work is a riddim, the
 * target belongs to that work, and the note belongs to that target. None of the
 * three ids in the URL is trusted on its own.
 */
async function guard(workId: string, targetId: string, noteId: string) {
  const t = await assertTargetOnRiddimWork(workId, targetId);
  if (!t.ok) return { ok: false as const, status: t.status, error: t.error };

  const note = await getMixTargetNote(noteId);
  if (!note || note.mixTargetId !== targetId) {
    return { ok: false as const, status: 404, error: "הערה לא נמצאה" };
  }
  return { ok: true as const };
}

/** PATCH — body: { noteText?: string; status?: "open" | "resolved" } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; targetId: string; noteId: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId, targetId, noteId } = await params;
    const g = await guard(workId, targetId, noteId);
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    const body = await req.json().catch(() => ({})) as { noteText?: string; status?: "open" | "resolved" };
    if (body.noteText === undefined && body.status === undefined) {
      return NextResponse.json({ ok: false, error: "אין מה לעדכן" }, { status: 400 });
    }

    const note = await updateMixTargetNote(noteId, { noteText: body.noteText, status: body.status });
    return NextResponse.json({ ok: true, note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; targetId: string; noteId: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId, targetId, noteId } = await params;
    const g = await guard(workId, targetId, noteId);
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    await deleteMixTargetNote(noteId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
