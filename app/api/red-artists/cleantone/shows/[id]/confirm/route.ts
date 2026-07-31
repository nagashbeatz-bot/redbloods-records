import { NextResponse } from "next/server";
import { requireCleantoneAccess } from "@/lib/require-auth";
import { getShow } from "@/lib/shows-store";
import { supabase } from "@/lib/supabase";
import { CLEANTONE_CLIENT_ID } from "@/lib/red-artists/cleantone";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/red-artists/cleantone/shows/[id]/confirm  (DJ CLEANTONE or owner)
 *
 * The client never sends/receives a dj_client_id for this check — it is the
 * server-side constant CLEANTONE_CLIENT_ID only. Atomic, conditional UPDATE:
 * the WHERE clause (id + dj_client_id + current status = 'ממתין לאישור') is
 * the sole guard — a real Postgres row-level condition, not a settings/claim
 * table. Wrong show, wrong DJ, or already-confirmed all fail to match and
 * return zero rows; no separate read-then-write race window. Never touches
 * shows.status, transactions, or Finance sync.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;

  const { id } = await ctx.params;

  const { data: updated, error } = await supabase
    .from("shows")
    .update({ dj_confirmation_status: "אושר", dj_confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("dj_client_id", CLEANTONE_CLIENT_ID)
    .eq("dj_confirmation_status", "ממתין לאישור")
    .select("id, dj_confirmation_status, dj_confirmed_at")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: "שגיאת שרת" }, { status: 500 });

  if (updated) {
    return NextResponse.json({
      ok: true,
      confirmation: { status: updated.dj_confirmation_status, confirmedAt: updated.dj_confirmed_at },
    });
  }

  // Zero rows matched the atomic UPDATE — determine why WITHOUT leaking
  // details about a show that isn't his (404 either way it's not his).
  const show = await getShow(id);
  if (!show || show.dj_client_id !== CLEANTONE_CLIENT_ID) {
    return NextResponse.json({ ok: false, error: "לא נמצא" }, { status: 404 });
  }
  if (show.dj_confirmation_status === "אושר") {
    // Idempotent: an earlier call already confirmed this exact show —
    // success, dj_confirmed_at is NOT touched again.
    return NextResponse.json({
      ok: true,
      confirmation: { status: show.dj_confirmation_status, confirmedAt: show.dj_confirmed_at },
      alreadyConfirmed: true,
    });
  }
  return NextResponse.json({ ok: false, error: "לא ניתן לאשר את ההופעה הזו כרגע" }, { status: 409 });
}
