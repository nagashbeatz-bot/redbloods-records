import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { victorMayDelete } from "@/lib/victor-scope";

/**
 * DELETE /api/vendor/victor/work/[id]/file  — delete ONE file from a Victor work's
 * `filesSent`, addressed only by an opaque `fileRef` (never a path).
 *
 * Owner + Victor may call it; the client never sends dropboxPath / URL / the full
 * filesSent array (which would risk losing paths / corruption). The server resolves
 * the fileRef against THIS work's own filesSent, deletes the real file from Dropbox,
 * and only then removes that single entry from the DB.
 *
 * Victor additionally may delete only a file HE uploaded that lies inside the work's own folder
 * (victorMayDelete): an Owner upload, an older entry with no uploader record, or a path outside the folder → 403.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireVictorAccess(); if (denied) return denied; // owner|victor; else 403/401
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const fileRef = typeof body?.fileRef === "string" ? body.fileRef.trim() : "";
    if (!fileRef) return NextResponse.json({ ok: false, error: "fileRef נדרש" }, { status: 400 });

    // Shared writer (lib/writes/victor): scope guard (a well-formed Victor row only), the fileRef resolved ONLY within
    // THIS work's filesSent, Victor may delete only his own upload inside the work folder (victorMayDelete), storage
    // FIRST, then only this entry (+ the version's review when it was the last file of that version).
    const role = await getAuthRole();
    const { deleteVictorWorkFileByRef } = await import("@/lib/writes/victor");
    const r = await deleteVictorWorkFileByRef(id, fileRef, (work, file) => role === "owner" || victorMayDelete(work, file));
    if (r === "not_found") return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (r === "file_not_found") return NextResponse.json({ ok: false, error: "file not found" }, { status: 404 });
    if (r === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    if (r === "storage_error") return NextResponse.json({ ok: false, error: "שגיאה במחיקה מ-Dropbox" }, { status: 500 });
    const { getVictorWorkById, sanitizeWorkForVictor } = await import("@/lib/vendor-store");

    // Return the fresh record so the client updates state from the server (never
    // rebuilds filesSent locally). Victor gets the path-free sanitized shape.
    const updated = await getVictorWorkById(id);
    const safe = updated && role === "victor" ? sanitizeWorkForVictor(updated) : updated;
    return NextResponse.json({ ok: true, work: safe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[victor work file delete]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
