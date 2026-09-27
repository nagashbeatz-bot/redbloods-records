/**
 * POST /api/red-films/productions/bulk-permanent-delete
 * Permanently deletes Red Films productions that are in "בוטל" status.
 * Also cleans up: reference_images (+ Dropbox files), budget_items, tasks.
 *
 * TODO: if red_films_scenes / red_films_crew / red_films_equipment are added
 *       in the future, add their cleanup here.
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteCancelledProductions } from "@/lib/writes/redfilms";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids נדרש" }, { status: 400 });
    }
    // Shared writer (lib/writes/redfilms) — the same one Sunny's DELETE_CANCELLED_PRODUCTIONS uses.
    const r = await deleteCancelledProductions(ids);
    if (r.kind === "bad") return NextResponse.json({ error: r.error }, { status: r.status });
    const { deleted, skipped } = r;
    return NextResponse.json({ ok: true, deleted, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאת שרת";
    console.error("[POST /api/red-films/productions/bulk-permanent-delete]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
