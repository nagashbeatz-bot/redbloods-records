import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listMixTargets, ensureInstrumental, addArtistTarget } from "@/lib/mix-targets-store";
import { assertRiddimWork } from "@/lib/riddim-work";

/**
 * GET /api/sound-engineer/[id]/targets — the riddim work's roster (owner view).
 *
 * READ-ONLY, deliberately: it does NOT create the instrumental line. A work whose
 * roster was never set up returns an empty list and the UI shows its empty state.
 * The instrumental is born from an explicit owner POST below and nowhere else.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const guard = await assertRiddimWork(workId);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    const targets = await listMixTargets(workId);
    return NextResponse.json({ ok: true, targets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer/[id]/targets — owner-only roster write.
 * Body: { name?: string }
 *   no name  → initialise the roster (creates the instrumental line only)
 *   name     → ensure the instrumental exists, then add that artist line
 *
 * This is the ONLY place the instrumental can come into existence, which is what
 * keeps every read path free of side effects. Re-adding a previously removed name
 * restores that row (status "restored") rather than creating a second one, so the
 * artist's old mixes and comments come back attached.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const guard = await assertRiddimWork(workId);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    const body = await req.json().catch(() => ({})) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";

    await ensureInstrumental(workId);
    if (!name) {
      return NextResponse.json({ ok: true, targets: await listMixTargets(workId) });
    }

    const result = await addArtistTarget(workId, name);
    if (result.status === "duplicate") {
      return NextResponse.json({ ok: false, error: "אמן בשם הזה כבר קיים בעבודה" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, targets: await listMixTargets(workId), added: result.target });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
