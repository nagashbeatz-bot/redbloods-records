import { NextRequest, NextResponse } from "next/server";
import {
  updateSoundEngineerWork,
  deleteSoundEngineerWork,
  forceSyncTransaction,
} from "@/lib/sound-engineer-store";
import type { SoundEngineerStatus, SoundEngineerWorkType } from "@/lib/types";

/**
 * PATCH /api/sound-engineer/[id]
 * Body: partial fields to update.
 * Auto-syncs the linked expense transaction if financial fields changed.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json() as Partial<{
      engineerName:     string;
      workType:         SoundEngineerWorkType;
      status:           SoundEngineerStatus;
      agreedPrice:      number;
      currency:         string;
      amountPaid:       number;
      sentDate:         string | null;
      internalDeadline: string | null;
      filesLink:        string | null;
      notes:            string;
    }>;

    const work = await updateSoundEngineerWork(id, body);
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/sound-engineer/[id]
 * Removes the work record. Does NOT delete the linked expense transaction.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteSoundEngineerWork(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer/[id] — force-sync the linked transaction.
 * Useful if auto-sync failed during creation/update.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await forceSyncTransaction(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
