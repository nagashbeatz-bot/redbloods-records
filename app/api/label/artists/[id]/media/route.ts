import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist } from "@/lib/label-artists-store";
import { getArtistMedia, createMedia, type MediaWriteResult } from "@/lib/media-income-store";
import { isRecordsIncomeKind } from "@/lib/records-expense-share";

export const dynamic = "force-dynamic";

function mapWrite(res: MediaWriteResult): NextResponse {
  if (res.ok) return NextResponse.json({ ok: true, id: res.id });
  const status = res.code === "LM400" ? 400 : res.code === "LM403" ? 403 : res.code === "LM404" ? 404 : res.code === "LM409" ? 409 : 500;
  return NextResponse.json({ error: res.message || "שגיאת שרת" }, { status });
}

// GET /api/label/artists/[id]/media — media summary for one artist.
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });
    const summary = await getArtistMedia(id, artist.name);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/media GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/label/artists/[id]/media — create a media income (allocation model 2026-09-29: ONE Finance transaction for the
// full amount + the artists' allocations by the rule — kind + credited label artists; a retry with the same requestKey
// returns the same income; financeTransactionId links the Owner's existing Finance income instead). No recoup target.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });

    const body = await req.json();
    const gross = Number(body.grossAmount);
    if (!Number.isFinite(gross) || gross < 0) return NextResponse.json({ error: "סכום לא תקין" }, { status: 400 });
    if (body.status !== undefined && !["התקבל", "צפוי"].includes(body.status)) return NextResponse.json({ error: "סטטוס לא חוקי" }, { status: 400 });

    if (body.incomeKind !== undefined && !isRecordsIncomeKind(body.incomeKind)) return NextResponse.json({ error: "סוג הכנסה לא חוקי" }, { status: 400 });
    if (body.creditedArtistIds !== undefined && !(Array.isArray(body.creditedArtistIds) && body.creditedArtistIds.every((x: unknown) => typeof x === "string" && x))) return NextResponse.json({ error: "רשימת אמנים לא תקינה" }, { status: 400 });
    if (body.requestKey !== undefined && !(typeof body.requestKey === "string" && /^[A-Za-z0-9:_-]{8,80}$/.test(body.requestKey))) return NextResponse.json({ error: "מפתח בקשה לא תקין" }, { status: 400 });
    if (body.financeTransactionId != null && !(typeof body.financeTransactionId === "string" && /^[0-9a-f-]{36}$/i.test(body.financeTransactionId))) return NextResponse.json({ error: "מזהה תנועה לא תקין" }, { status: 400 });

    const res = await createMedia(id, artist.name, {
      grossAmount: gross,
      source: typeof body.source === "string" ? body.source.trim() : undefined,
      reportPeriod: typeof body.reportPeriod === "string" ? body.reportPeriod.trim() : undefined,
      receivedDate: body.receivedDate || null,
      status: body.status,
      notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
      incomeKind: body.incomeKind,
      creditedArtistIds: body.creditedArtistIds,
      requestKey: body.requestKey,
      financeTransactionId: body.financeTransactionId ?? null,
    });
    return mapWrite(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/media POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
