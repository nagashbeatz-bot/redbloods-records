import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { moveVictorWorkMonth } from "@/lib/writes/victor-month";

/**
 * POST /api/vendor/victor/work/[id]/month  { toMonth: "YYYY-MM" } — "העבר לחודש אחר" (OWNER ONLY, checked here: the proxy
 * lets a Victor session reach /api/vendor/victor/work/*). Changes only the work's month attribution — never the sent
 * date, completion, deadline, status, files, notes or money; no push. Shared writer: lib/writes/victor-month moveVictorWorkMonth.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { toMonth?: unknown };
    const r = await moveVictorWorkMonth(id, String(body.toMonth ?? ""));
    switch (r.kind) {
      case "ok": return NextResponse.json({ ok: true, from: r.from, to: r.to, attributedMonth: r.attributedMonth });
      case "no_change": return NextResponse.json({ ok: false, error: "העבודה כבר משויכת לחודש הזה" }, { status: 400 });
      case "invalid": return NextResponse.json({ ok: false, error: "חודש לא תקין" }, { status: 400 });
      case "not_found": return NextResponse.json({ ok: false, error: "העבודה לא נמצאה" }, { status: 404 });
      case "conflict": return NextResponse.json({ ok: false, error: "העבודה עודכנה במקביל — רענן ונסה שוב" }, { status: 409 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
