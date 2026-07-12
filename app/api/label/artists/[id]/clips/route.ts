import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { parseArtistNames } from "@/lib/clients-store";
import { supabase } from "@/lib/supabase";
import type { LabelClipLine, ArtistClipsSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/label/artists/[id]/clips — clip label investment for one artist.
// Single source of truth: red_films_productions.general_budget (read live, no copy).
// Per the label rule the full budget is treated as paid; label investment = budget/2,
// artist recoup = budget/2 (display only). No clip_items, no transactions, no paidTotal.
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const { data, error } = await supabase
      .from("red_films_productions")
      .select("id, title, status, project_id, artist_name, production_type, general_budget");
    if (error) throw new Error(error.message);

    const clips: LabelClipLine[] = [];
    const totals = { fullBudget: 0, labelInvestment: 0, artistRecoupBalance: 0, count: 0 };

    for (const p of data ?? []) {
      const prod = p as { id: string; title: string; status: string; project_id: string | null; artist_name: string | null; production_type: string | null; general_budget: number | null };
      if (prod.production_type !== "קליפ") continue;                    // clips only
      if (prod.status === "בוטל") continue;                              // cancelled excluded
      if (!parseArtistNames(prod.artist_name || "").includes(artist.name)) continue; // this artist

      const fullBudget = Number(prod.general_budget) || 0;
      const labelInvestment = fullBudget / 2;
      const artistRecoupBalance = fullBudget / 2;

      clips.push({
        id: prod.id, title: prod.title, status: prod.status, projectId: prod.project_id,
        fullBudget, labelInvestment, artistRecoupBalance,
      });
      totals.fullBudget += fullBudget;
      totals.labelInvestment += labelInvestment;
      totals.artistRecoupBalance += artistRecoupBalance;
      totals.count += 1;
    }

    const payload: ArtistClipsSummary = { totals, clips };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/clips GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
