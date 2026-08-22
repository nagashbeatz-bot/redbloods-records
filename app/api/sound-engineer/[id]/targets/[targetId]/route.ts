import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getMixTarget, renameArtistTarget, softRemoveTarget } from "@/lib/mix-targets-store";

/** Resolve the target and confirm it really belongs to the work in the URL —
 *  stops a target id from one work being edited through another work's path. */
async function assertTargetOnWork(workId: string, targetId: string) {
  const target = await getMixTarget(targetId);
  if (!target || target.workId !== workId) return null;
  return target;
}

/**
 * PATCH /api/sound-engineer/[id]/targets/[targetId] — rename an artist line.
 * Body: { name: string }
 *
 * Renaming writes display_name and nothing else: every mix_versions row keeps
 * pointing at this id, so no mix, file or comment moves. The instrumental is
 * rejected — its label comes from the page's translations, not from the DB.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; targetId: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId, targetId } = await params;
    if (!(await assertTargetOnWork(workId, targetId))) {
      return NextResponse.json({ ok: false, error: "אמן לא נמצא" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({})) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ ok: false, error: "שם אמן חסר" }, { status: 400 });

    const result = await renameArtistTarget(targetId, name);
    if (result.status === "not_found")    return NextResponse.json({ ok: false, error: "אמן לא נמצא" }, { status: 404 });
    if (result.status === "instrumental") return NextResponse.json({ ok: false, error: "לא ניתן לשנות את שם האינסטרומנטל" }, { status: 400 });
    if (result.status === "duplicate")    return NextResponse.json({ ok: false, error: "אמן בשם הזה כבר קיים בעבודה" }, { status: 409 });
    return NextResponse.json({ ok: true, target: result.target });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/sound-engineer/[id]/targets/[targetId] — remove an artist line
 * from the roster. ALWAYS a soft remove: the line's mixes, files and comments
 * stay and remain visible; only the upload picker stops offering it. The roster
 * can change, the work's history cannot. The instrumental can never be removed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; targetId: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId, targetId } = await params;
    if (!(await assertTargetOnWork(workId, targetId))) {
      return NextResponse.json({ ok: false, error: "אמן לא נמצא" }, { status: 404 });
    }

    const result = await softRemoveTarget(targetId);
    if (result.status === "not_found")    return NextResponse.json({ ok: false, error: "אמן לא נמצא" }, { status: 404 });
    if (result.status === "instrumental") return NextResponse.json({ ok: false, error: "לא ניתן להסיר את האינסטרומנטל" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
