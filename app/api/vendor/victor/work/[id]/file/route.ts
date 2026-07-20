import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { fileRefOf } from "@/lib/victor-files";
import type { FileLink, VersionReview } from "@/lib/types";

// ── Version-key helpers (pure) — kept in sync with VictorProfilePage.tsx so the
//    server prunes a version's review exactly like the owner's client flow does. ──
function parseVersionKey(name: string): string | null {
  const n = name.toLowerCase();
  const m = n.match(/\bv[\s._-]?(\d{1,3})\b/) || n.match(/version[\s._-]?(\d{1,3})/) || n.match(/מיקס[\s._-]?(\d{1,3})/);
  if (m) return `V${Number(m[1])}`;
  if (/\bfinal\b|פיינל/.test(n)) return "FINAL";
  if (/\bfix\b/.test(n))         return "FIX";
  return null;
}
function versionKeysOf(files: FileLink[]): Set<string> {
  const keys = new Set<string>();
  if (files.length === 0) return keys;
  const vkeys = files.map(f => (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) ? f.versionLabel.toUpperCase() : parseVersionKey(f.name));
  if (!vkeys.some(Boolean)) { keys.add("all"); return keys; }
  for (const k of vkeys) keys.add(k ?? "__untagged__");
  return keys;
}

/**
 * DELETE /api/vendor/victor/work/[id]/file  — delete ONE file from a Victor work's
 * `filesSent`, addressed only by an opaque `fileRef` (never a path).
 *
 * Owner + Victor may call it; the client never sends dropboxPath / URL / the full
 * filesSent array (which would risk losing paths / corruption). The server resolves
 * the fileRef against THIS work's own filesSent, deletes the real file from Dropbox,
 * and only then removes that single entry from the DB.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireVictorAccess(); if (denied) return denied; // owner|victor; else 403/401
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const fileRef = typeof body?.fileRef === "string" ? body.fileRef.trim() : "";
    if (!fileRef) return NextResponse.json({ ok: false, error: "fileRef נדרש" }, { status: 400 });

    const { getVictorWorkById, updateVictorWork, sanitizeWorkForVictor } = await import("@/lib/vendor-store");

    const work = await getVictorWorkById(id);
    if (!work) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    // Scope guard: this endpoint manages Victor's rows only.
    if (work.vendorName !== "victor") return NextResponse.json({ error: "forbidden" }, { status: 403 });

    // Resolve the fileRef ONLY within THIS work's filesSent — never receivedFiles /
    // briefFiles, and never another work's files. A ref from elsewhere → 404.
    const filesSent: FileLink[] = work.filesSent ?? [];
    const idx = filesSent.findIndex(f => f.dropboxPath && fileRefOf(f.dropboxPath) === fileRef);
    if (idx < 0) return NextResponse.json({ ok: false, error: "file not found" }, { status: 404 });
    const dropboxPath = filesSent[idx].dropboxPath as string;

    // Delete from Dropbox FIRST. Only touch the DB after it succeeds (or is already
    // gone). A real failure keeps the file so nothing is left orphaned/inconsistent.
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: dropboxPath }),
    });
    if (!delRes.ok) {
      const errText = await delRes.text();
      let summary = errText;
      try { summary = JSON.parse(errText)?.error_summary ?? errText; } catch { /* keep raw */ }
      // Already gone in Dropbox → idempotent success: still remove the DB metadata.
      if (!summary.includes("not_found")) {
        console.error("[victor work file delete]", summary);
        return NextResponse.json({ ok: false, error: "שגיאה במחיקה מ-Dropbox" }, { status: 500 });
      }
    }

    // Remove ONLY this entry; keep every other file exactly as-is (paths intact).
    const nextFiles = filesSent.filter((_, i) => i !== idx);

    // If the file was the last of its version, prune that version's review too —
    // matches the owner client flow. Otherwise leave versionReviews untouched.
    const remainingKeys = versionKeysOf(nextFiles);
    const reviews = work.versionReviews ?? {};
    const prunedReviews = Object.fromEntries(
      Object.entries(reviews).filter(([k]) => remainingKeys.has(k)),
    ) as Record<string, VersionReview>;
    const reviewsChanged = Object.keys(prunedReviews).length !== Object.keys(reviews).length;

    await updateVictorWork(id, reviewsChanged ? { filesSent: nextFiles, versionReviews: prunedReviews } : { filesSent: nextFiles });

    // Return the fresh record so the client updates state from the server (never
    // rebuilds filesSent locally). Victor gets the path-free sanitized shape.
    const updated = await getVictorWorkById(id);
    const safe = updated && (await getAuthRole()) === "victor" ? sanitizeWorkForVictor(updated) : updated;
    return NextResponse.json({ ok: true, work: safe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[victor work file delete]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
