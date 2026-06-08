/**
 * DELETE /api/red-films/documents/[docId]
 * Deletes document from Dropbox and removes the row from DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ docId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { docId } = await ctx.params;

    const { data: row, error: fetchErr } = await supabase
      .from("red_films_documents")
      .select("dropbox_path")
      .eq("id", docId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!row) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });

    // ── 1. Delete from Dropbox (non-fatal) ────────────────────────────────────
    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: row.dropbox_path }),
      });
    } catch { /* non-fatal */ }

    // ── 2. Delete from DB ─────────────────────────────────────────────────────
    const { error: delErr } = await supabase
      .from("red_films_documents")
      .delete()
      .eq("id", docId);

    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/red-films/documents/[docId]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
