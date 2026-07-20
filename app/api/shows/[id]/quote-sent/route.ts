import { NextResponse } from "next/server";
import { getShow } from "@/lib/shows-store";
import type { Show } from "@/lib/shows-store";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";
import { ensureQuoteFollowupTask } from "@/lib/show-quote-followup";
import { isConfirmedShowStatus } from "@/lib/shows-finance-sync";

type Ctx = { params: Promise<{ id: string }> };

/** If show.artist is empty but artist_client_id exists, resolve name from DB. */
async function resolveArtistName(show: Show): Promise<Show> {
  if (show.artist || !show.artist_client_id) return show;
  const { data } = await supabase
    .from("clients").select("name").eq("id", show.artist_client_id).single();
  if (data?.name) return { ...show, artist: data.name };
  return show;
}

/**
 * POST /api/shows/[id]/quote-sent
 * Called by the UI right AFTER a quote ("הצעת מחיר") was saved (POST/PATCH).
 * Server-authoritative: reads the freshly-saved show and upserts its single
 * "פולואפ להצעת מחיר" task (dedup by show_id + marker). No Push in this commit.
 * Only acts for pipeline (lead/quote) shows; a no-op for confirmed ones.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const raw = await getShow(id);
    if (!raw) return NextResponse.json({ error: "הופעה לא נמצאה" }, { status: 404 });

    // Guard: only a pipeline (lead/quote) record gets a follow-up task.
    if (isConfirmedShowStatus(raw.status) || raw.status === "בוטל") {
      return NextResponse.json({ skipped: true });
    }

    const show = await resolveArtistName(raw);
    const { task, created } = await ensureQuoteFollowupTask({
      showId:  show.id,
      artist:  show.artist,
      contact: show.contact_person || show.booker_name,
      amount:  show.show_price,
      date:    show.date,
      status:  show.status,
    });

    return NextResponse.json({ task, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[shows quote-sent] error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
