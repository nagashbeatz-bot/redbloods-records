/**
 * DELETE /api/red-films/references/[refId]
 * Deletes image from Dropbox and removes the row from DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ refId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { refId } = await ctx.params;

    // Fetch the row first so we have the dropbox_path
    const { data: row, error: fetchErr } = await supabase
      .from("red_films_reference_images")
      .select("dropbox_path")
      .eq("id", refId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!row) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });

    // ── 1. Delete from Dropbox (non-fatal if already gone) ────────────────────
    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: row.dropbox_path }),
      });
    } catch { /* non-fatal — row will still be deleted from DB */ }

    // ── 2. Delete from DB ─────────────────────────────────────────────────────
    const { error: delErr } = await supabase
      .from("red_films_reference_images")
      .delete()
      .eq("id", refId);

    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/red-films/references/[refId]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
