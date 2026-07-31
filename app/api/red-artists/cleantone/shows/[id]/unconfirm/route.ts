import { NextResponse } from "next/server";
import { requireCleantoneAccess } from "@/lib/require-auth";
import { getShow } from "@/lib/shows-store";
import { supabase } from "@/lib/supabase";
import { CLEANTONE_CLIENT_ID } from "@/lib/red-artists/cleantone";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/red-artists/cleantone/shows/[id]/unconfirm  (DJ CLEANTONE or owner)
 *
 * Exact mirror of .../confirm/route.ts, reversed: 'אושר' → 'ממתין לאישור',
 * dj_confirmed_at reset to null. The client never sends/receives a
 * dj_client_id for this check — server-side constant only. Atomic conditional
 * UPDATE (id + his dj_client_id + current status = 'אושר') is the sole guard;
 * wrong show, wrong DJ, or already-pending all fail to match and return zero
 * rows. Never touches shows.status, transactions, or Finance sync.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;

  const { id } = await ctx.params;

  const { data: updated, error } = await supabase
    .from("shows")
    .update({ dj_confirmation_status: "ממתין לאישור", dj_confirmed_at: null })
    .eq("id", id)
    .eq("dj_client_id", CLEANTONE_CLIENT_ID)
    .eq("dj_confirmation_status", "אושר")
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
  if (show.dj_confirmation_status === "ממתין לאישור") {
    // Idempotent: an earlier call already unconfirmed this exact show —
    // success, no further change.
    return NextResponse.json({
      ok: true,
      confirmation: { status: show.dj_confirmation_status, confirmedAt: show.dj_confirmed_at },
      alreadyUnconfirmed: true,
    });
  }
  return NextResponse.json({ ok: false, error: "לא ניתן לבטל את האישור כרגע" }, { status: 409 });
}
