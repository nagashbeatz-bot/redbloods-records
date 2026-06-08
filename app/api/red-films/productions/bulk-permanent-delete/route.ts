/**
 * POST /api/red-films/productions/bulk-permanent-delete
 * Permanently deletes Red Films productions that are in "בוטל" status.
 * Also cleans up: reference_images (+ Dropbox files), budget_items, tasks.
 *
 * TODO: if red_films_scenes / red_films_crew / red_films_equipment are added
 *       in the future, add their cleanup here.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids נדרש" }, { status: 400 });
    }
    const productionIds = ids.filter((id): id is string => typeof id === "string");
    if (productionIds.length === 0) {
      return NextResponse.json({ error: "ids לא תקינים" }, { status: 400 });
    }

    // ── 1. Guard: only allow "בוטל" productions ────────────────────────────────
    const { data: productions, error: fetchErr } = await supabase
      .from("red_films_productions")
      .select("id, status")
      .in("id", productionIds);

    if (fetchErr) throw fetchErr;

    const allowedIds = (productions ?? [])
      .filter(p => p.status === "בוטל")
      .map(p => p.id);

    if (allowedIds.length === 0) {
      return NextResponse.json({ error: "אין הפקות מבוטלות למחיקה" }, { status: 400 });
    }

    const skipped = productionIds.length - allowedIds.length;

    // ── 2. Reference images — delete from Dropbox (non-fatal) + DB ────────────
    const { data: refImages } = await supabase
      .from("red_films_reference_images")
      .select("id, dropbox_path")
      .in("production_id", allowedIds);

    if (refImages && refImages.length > 0) {
      try {
        const { getDropboxToken } = await import("@/lib/dropbox-token");
        const token = await getDropboxToken();
        await Promise.all(
          refImages.map(r =>
            fetch("https://api.dropboxapi.com/2/files/delete_v2", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ path: r.dropbox_path }),
            }).catch(() => { /* non-fatal */ })
          )
        );
      } catch { /* non-fatal — DB rows will still be deleted */ }

      await supabase
        .from("red_films_reference_images")
        .delete()
        .in("production_id", allowedIds);
    }

    // ── 3. Budget items ────────────────────────────────────────────────────────
    await supabase
      .from("red_films_budget_items")
      .delete()
      .in("production_id", allowedIds);

    // ── 4. Tasks (all — production is gone permanently) ────────────────────────
    // Google Tasks cleanup: future tasks should already be cancelled when moved to trash.
    // We attempt cleanup for any remaining calendar_event_ids before deleting from DB.
    try {
      const { data: tasksWithGoogle } = await supabase
        .from("tasks")
        .select("id, calendar_event_id")
        .eq("related_type", "red_film_production")
        .in("related_id", allowedIds)
        .not("calendar_event_id", "is", null);

      if (tasksWithGoogle && tasksWithGoogle.length > 0) {
        const { isConnected, deleteGoogleTask } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          await Promise.all(
            tasksWithGoogle.map(t =>
              t.calendar_event_id
                ? deleteGoogleTask(t.calendar_event_id).catch(() => { /* non-fatal */ })
                : Promise.resolve()
            )
          );
        }
      }
    } catch { /* non-fatal */ }

    await supabase
      .from("tasks")
      .delete()
      .eq("related_type", "red_film_production")
      .in("related_id", allowedIds);

    // ── 5. Delete productions ──────────────────────────────────────────────────
    const { error: delErr } = await supabase
      .from("red_films_productions")
      .delete()
      .in("id", allowedIds);

    if (delErr) throw delErr;

    return NextResponse.json({ ok: true, deleted: allowedIds.length, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאת שרת";
    console.error("[POST /api/red-films/productions/bulk-permanent-delete]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
