import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getSoundEngineerWork, stevenDisplayName } from "@/lib/sound-engineer-store";
import { notifyStevenMixReady } from "@/lib/steven-mix-ready-notify";

/**
 * POST /api/sound-engineer/[id]/notify-mix-ready  (?resend=1 to send again)
 *
 * OWNER ONLY. Fired ONLY by the "Send to Steven" button — never automatically.
 * Takes just the workId; the server loads the work and builds the displayName
 * itself (workTitle || projectName) so the client can't spoof the text. Sends a
 * "New mix job" push to owner + Steven. Deduped in settings; first send returns
 * { alreadySent } so the UI can confirm before resending.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const resend = req.nextUrl.searchParams.get("resend") === "1";

    const work = await getSoundEngineerWork(id);
    if (!work) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });

    const result = await notifyStevenMixReady(
      { id: work.id, displayName: stevenDisplayName(work) },
      { resend },
    );
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/notify-mix-ready]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
