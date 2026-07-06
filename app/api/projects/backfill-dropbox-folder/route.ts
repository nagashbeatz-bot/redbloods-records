import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { supabase } from "@/lib/supabase";
import { projectBaseFolder } from "@/lib/project-paths";

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
    const { data, error } = await supabase
      .from("projects")
      .select("id, artist, name, dropbox_folder")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    const projects = (data ?? []) as { id: string; artist: string | null; name: string | null; dropbox_folder: string | null }[];

    const rows = projects.map((p) => {
      const current  = (p.dropbox_folder ?? "").trim();
      const computed = projectBaseFolder(p.artist ?? "", p.name ?? "", p.id);
      const alreadyFrozen = current.length > 0;
      return {
        id: p.id,
        artist: p.artist ?? "",
        name: p.name ?? "",
        current: current || null,      // already-stored path (null if not set)
        computed,                      // what freeze would store
        willSet: !alreadyFrozen,       // only null/empty get written
      };
    });

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

    // ── APPLY: freeze-once. Only rows where dropbox_folder is null/empty. ──
    // Never overwrites an existing value; never touches Dropbox / name.
    const applied: { id: string; dropbox_folder: string }[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const r of toSet) {
      const { error: upErr } = await supabase
        .from("projects")
        .update({ dropbox_folder: r.computed })
        .eq("id", r.id)
        .is("dropbox_folder", null); // extra guard: only when still null (race-safe, never overwrite)
      if (upErr) failed.push({ id: r.id, error: upErr.message });
      else applied.push({ id: r.id, dropbox_folder: r.computed });
    }

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
