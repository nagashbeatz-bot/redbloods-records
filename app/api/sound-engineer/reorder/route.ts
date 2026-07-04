import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { reorderSoundEngineerWork } from "@/lib/sound-engineer-store";

/**
 * POST /api/sound-engineer/reorder
 * Body: { ids: string[] } — the work ids in their new display order.
 * Writes sound_engineer_work.sort_order = index for each. Owner only.
 */
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && !!x) : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "ids חסר או ריק" }, { status: 400 });
    }
    await reorderSoundEngineerWork(ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
