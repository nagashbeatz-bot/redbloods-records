import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { setSketchDuration, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

const ID_RE = /^[0-9a-fA-F-]{36}$/;

// POST /api/red-artists/sketches/[id]/duration — persist a learned track length into
// the manifest (NEVER writes to Projects). body: { versionNumber, durationSeconds }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!ID_RE.test(id)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const body = await req.json().catch(() => ({}));
    const versionNumber = Number(body.versionNumber);
    const durationSeconds = Number(body.durationSeconds);
    if (!Number.isFinite(versionNumber) || versionNumber < 1) throw new SketchError("BAD_INPUT", "מספר גרסה לא תקין");
    await setSketchDuration(id, Math.round(versionNumber), Math.round(durationSeconds));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errResponse(err);
  }
}
