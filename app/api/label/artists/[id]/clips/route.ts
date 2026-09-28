import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listArtistClips, artistClipMoney, artistClipAllocation, uniqueShareTransactions } from "@/lib/label-clips";
import { CLIP_RECOUP_NOT_DEFINED_HE } from "@/lib/clip-rf-money-pure";
import { agreementArtistOf, AGREEMENT_CYCLE_ACCOUNTING_HE } from "@/lib/label-agreements";
import type { LabelClipLine, ArtistClipsSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/label/artists/[id]/clips — the artist's clips with A / B / C per currency (B3, Owner canon 2026-09-27):
// A client clip price, B planned budget, C actual cost (Finance, paid), + the Red Films ledger (not in Finance).
// Never added together. The split of C is the ONE rule lib/records-expense-share (Owner decision 2026-09-28, per Finance
// transaction, by the project's credits) — `agreement` (this artist's totals) + `shareTransactions` (each transaction once,
// with its id, so the label page counts the cash once across artists). No recoup (D NOT_DEFINED, with that reason).
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const clips = await listArtistClips(artist.name, artist.id);
    const lines: LabelClipLine[] = clips.map((c) => ({
      id: c.id, title: c.title, status: c.status, projectId: c.projectId,
      plannedBudget: c.plannedBudget, currency: c.currency, clientClipPrice: c.clientClipPrice, clientClipCurrency: c.clientClipCurrency,
      actualCostPaid: c.actualCostPaid, rfLedgerPaid: c.rfLedgerPaid,
      recoupStatus: c.recoup.status, artistRecoupBalance: null, recoupReasonHe: c.recoup.reasonHe,
      allocation: c.allocation,
    }));
    const covered = !!agreementArtistOf({ id: artist.id });
    const payload: ArtistClipsSummary = {
      totals: { count: clips.length, byCurrency: artistClipMoney(clips) },
      recoupStatus: "NOT_DEFINED",
      recoupReasonHe: covered ? AGREEMENT_CYCLE_ACCOUNTING_HE : CLIP_RECOUP_NOT_DEFINED_HE,
      agreement: artistClipAllocation(clips),
      shareTransactions: uniqueShareTransactions(clips),
      clips: lines,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/clips GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
