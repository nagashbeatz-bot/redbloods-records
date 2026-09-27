import { NextResponse } from "next/server";
import { requireVictorAccess, requireOwner, getAuthRole } from "@/lib/require-auth";

import { victorMayPatch } from "@/lib/victor-scope";
import { ownerPatchVictorWork, removeVictorWork } from "@/lib/writes/victor";

/**
 * GET    /api/vendor/victor/work/[id]  — fetch a single work record (victor/owner)
 * PATCH  /api/vendor/victor/work/[id]  — update a work record (owner only in practice: Victor may patch nothing —
 *                                         his files are written server-side by upload / delete, never by a client path)
 * DELETE /api/vendor/victor/work/[id]  — delete a work record (owner only)
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    const { getScopedVictorWork, sanitizeWorkForVictor } = await import("@/lib/vendor-store");
    const work = await getScopedVictorWork(id); // well-formed id + a Victor row, else 404
    if (!work) return NextResponse.json({ ok: false, work: null }, { status: 404 });
    // Victor never receives Artist/Project/Dropbox-folder fields; owner gets all.
    const safe = (await getAuthRole()) === "victor" ? sanitizeWorkForVictor(work) : work;
    return NextResponse.json({ ok: true, work: safe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json();

    // Victor = view only here. Status / work-state / deadlines are the Owner's, and file or folder fields
    // (filesSent / filesReceived / dropboxFolder / dropboxShareLink) would let a client choose Dropbox paths that
    // stream / download / delete / upload then act on. Victor's files change only through the server-side
    // upload and delete routes. Owner may patch anything.
    if ((await getAuthRole()) !== "owner" && !victorMayPatch(body)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { getVictorWorkById } = await import("@/lib/vendor-store");

    // Fetch existing record before update (needed for linked_task_id + projectName)
    const existingWork = await getVictorWorkById(id);

    // Ownership guard: this endpoint only manages Victor's work rows.
    if (existingWork && existingWork.vendorName !== "victor") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Apply all regular field updates
    // Shared writer (lib/writes/victor): the update, the completed push on a real → הושלם transition, and the
    // internal-deadline follow-up task / Google Task. The Victor-role checks above stay here.
    await ownerPatchVictorWork(id, body);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    // Shared writer: the follow-up task (+ Google Task) first, then the work (hardened 2026-09-27).
    const r = await removeVictorWork(id);
    return NextResponse.json({ ok: true, removedTask: r.removedTask });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
