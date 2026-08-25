import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { assertTargetOnRiddimWork } from "@/lib/riddim-work";
import { listMixTargetNotes, createMixTargetNote } from "@/lib/mix-target-notes-store";

/**
 * Pre-mix notes on one riddim mix line — the owner's briefing for an artist who
 * has no version yet ("stems are here", "use this acapella").
 *
 * Every method runs the same guard first: the work must be a riddim AND the
 * target in the URL must belong to THAT work, re-read from the DB. A target id
 * from another engineer's work resolves to 404, never to data.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId, targetId } = await params;
    const guard = await assertTargetOnRiddimWork(workId, targetId);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    return NextResponse.json({ ok: true, notes: await listMixTargetNotes(targetId) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST — add a note. OWNER ONLY: these are instructions going TO Steven, so
 * there is deliberately no counterpart on his supplier surface.
 * Body: { noteText: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId, targetId } = await params;
    const guard = await assertTargetOnRiddimWork(workId, targetId);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    const body = await req.json().catch(() => ({})) as { noteText?: string };
    const noteText = (body.noteText ?? "").trim();
    if (!noteText) return NextResponse.json({ ok: false, error: "טקסט ההערה חסר" }, { status: 400 });

    const note = await createMixTargetNote({ mixTargetId: targetId, noteText });
    return NextResponse.json({ ok: true, note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
