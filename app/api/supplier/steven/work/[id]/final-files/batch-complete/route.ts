import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { assertStevenOwnsWork } from "@/lib/steven-scope";
import { completeFinalFilesBatch } from "@/lib/final-files-batch-notify";

const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

/** POST /api/supplier/steven/work/[id]/final-files/batch-complete — called by
 *  the client right after its "Upload Final Files" upload loop finishes (every
 *  file terminal). Sends AT MOST one owner push summarizing the batch;
 *  idempotent, so a double-click/retry/StrictMode re-invoke never duplicates. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    if (!(await assertStevenOwnsWork(workId))) return FORBID();

    const body = await req.json().catch(() => ({}));
    const batchId = typeof body?.batchId === "string" ? body.batchId : "";
    if (!batchId) return NextResponse.json({ ok: false, error: "batchId חסר" }, { status: 400 });

    await completeFinalFilesBatch(batchId, workId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Best-effort notification path — never surface a hard failure to the client.
    console.error("[supplier/steven/final-files/batch-complete]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true });
  }
}
