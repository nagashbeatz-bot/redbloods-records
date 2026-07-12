import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listArtistClips, round2 } from "@/lib/label-clips";
import type { LabelClipLine, ArtistClipsSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/label/artists/[id]/clips — clip label investment for one artist.
// Single source: red_films_productions.general_budget via the shared clip helper
// (labelInvestment = round(budget/2,2); artistRecoup = budget − labelInvestment).
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const clips = await listArtistClips(artist.name);
    const lines: LabelClipLine[] = clips.map((c) => ({
      id: c.id, title: c.title, status: c.status, projectId: c.projectId,
      fullBudget: c.fullBudget, labelInvestment: c.labelInvestment, artistRecoupBalance: c.artistRecoupTarget,
    }));
    const totals = {
      fullBudget: round2(clips.reduce((s, c) => s + c.fullBudget, 0)),
      labelInvestment: round2(clips.reduce((s, c) => s + c.labelInvestment, 0)),
      artistRecoupBalance: round2(clips.reduce((s, c) => s + c.artistRecoupTarget, 0)),
      count: clips.length,
    };
    const payload: ArtistClipsSummary = { totals, clips: lines };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/clips GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
