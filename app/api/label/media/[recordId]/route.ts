import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { updateMedia, type MediaWriteResult } from "@/lib/media-income-store";
import { isRecordsIncomeKind } from "@/lib/records-expense-share";

export const dynamic = "force-dynamic";

function mapWrite(res: MediaWriteResult): NextResponse {
  if (res.ok) return NextResponse.json({ ok: true, id: res.id });
  const status = res.code === "LM400" ? 400 : res.code === "LM403" ? 403 : res.code === "LM404" ? 404 : res.code === "LM409" ? 409 : 500;
  return NextResponse.json({ error: res.message || "שגיאת שרת" }, { status });
}

// PATCH /api/label/media/[recordId] — update a media record.
// Financial fields on a received record are rejected by the RPC (LM403); the RPC
// verifies the record belongs to the given artist; the server passes no recoup target (media = 50 / 50 income, never a clip repayment).
export async function PATCH(req: NextRequest, context: { params: Promise<{ recordId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { recordId } = await context.params;
    const body = await req.json();

    const artistId = body.artistId;
    if (!artistId || typeof artistId !== "string") return NextResponse.json({ error: "מזהה אמן חסר" }, { status: 400 });
    if (typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt) return NextResponse.json({ error: "חסר חותם עדכון" }, { status: 400 });

    const artist = await getLabelArtist(artistId);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    if (body.incomeKind !== undefined && !isRecordsIncomeKind(body.incomeKind)) return NextResponse.json({ error: "סוג הכנסה לא חוקי" }, { status: 400 });
    if (body.creditedArtistIds !== undefined && !(Array.isArray(body.creditedArtistIds) && body.creditedArtistIds.every((x: unknown) => typeof x === "string" && x))) return NextResponse.json({ error: "רשימת אמנים לא תקינה" }, { status: 400 });

    const res = await updateMedia(recordId, artistId, artist.name, body.expectedUpdatedAt, {
      grossAmount: body.grossAmount != null ? Number(body.grossAmount) : undefined,
      source: typeof body.source === "string" ? body.source.trim() : undefined,
      reportPeriod: typeof body.reportPeriod === "string" ? body.reportPeriod.trim() : undefined,
      receivedDate: body.receivedDate ?? undefined,
      clearReceivedDate: body.clearReceivedDate === true,
      status: body.status ?? undefined,
      notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
      // allocation model, expected income only (the RPC refuses it on a received / legacy record): kind / credits → re-derived allocations
      incomeKind: body.incomeKind,
      creditedArtistIds: body.creditedArtistIds,
    });
    return mapWrite(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/media PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
