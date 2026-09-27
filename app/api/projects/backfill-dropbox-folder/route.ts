import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

// Session-sensitive: must run per-request so requireOwner reads the live cookies.
// Without this the static-path GET can be prerendered at build (cookies() throws,
// getAuthUser swallows it → a cached 401), which is why owner wasn't recognized.
export const dynamic = "force-dynamic";

/**
 * GET /api/projects/backfill-dropbox-folder
 *
 * One-time freeze of each project's canonical Dropbox base folder into the new
 * projects.dropbox_folder column, so that renaming a project never moves/creates
 * a Dropbox folder afterwards.
 *
 * OWNER ONLY (requireOwner + behind the proxy auth gate). Safe by design:
 *   • Default = DRY-RUN. Returns what WOULD be written; touches nothing.
 *   • ?apply=1 = write mode. Sets dropbox_folder ONLY where it is currently
 *     null/empty (freeze-once — never overwrites an already-frozen path).
 *   • NEVER touches Dropbox (no folder create/move/delete), NEVER changes name,
 *     NEVER deletes anything. It only writes the one text column.
 *
 * The computed value is exactly today's canonical folder:
 *   projectBaseFolder(artist, name, id) → /Projects/{primaryArtist}/{name}
 */
export async function GET(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;

  const apply = req.nextUrl.searchParams.get("apply") === "1";

  try {
    // shared writer (lib/writes/backfills): plan = today's canonical folder per project; apply = freeze-once
    const { folderFreezePlan, applyFolderFreeze } = await import("@/lib/writes/backfills");
    const rows = await folderFreezePlan();
    const toSet = rows.filter((r) => r.willSet);

    // ── DRY-RUN (default): show only, write nothing ──
    if (!apply) {
      return NextResponse.json({
        mode: "dry-run",
        note: "Nothing written. Re-run with ?apply=1 to freeze the paths (owner-only).",
        summary: { total: rows.length, alreadyFrozen: rows.length - toSet.length, willSet: toSet.length },
        rows,
      });
    }

    const { applied, failed } = await applyFolderFreeze(toSet);
    return NextResponse.json({
      mode: "apply",
      summary: { total: rows.length, applied: applied.length, skippedAlreadyFrozen: rows.length - toSet.length, failed: failed.length },
      applied,
      failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects/backfill-dropbox-folder]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
