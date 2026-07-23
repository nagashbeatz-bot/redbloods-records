import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requireShalevAccess } from "@/lib/require-auth";
import { getNextWorkConfig, setNextWorkConfig } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

// The portal's "next project to work on" — OWNER-chosen, manifest-stored, fully
// SEPARATE from nextRelease. Readable by the artist (shalev) so his home card shows
// the result; only the owner may SET it (POST).

// GET /api/red-artists/next-work → { work } (null when unset).
export async function GET() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const work = await getNextWorkConfig();
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/red-artists/next-work — set it. body: { sketchId, deadline?: string|null }.
// sketchId MUST be an active sketch from the manifest (never a Project id / nextRelease).
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const deadlineRaw = body?.deadline;
    const deadline = typeof deadlineRaw === "string" && deadlineRaw.trim() ? deadlineRaw.trim() : null;
    const work = await setNextWorkConfig(String(body?.sketchId ?? ""), deadline);
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    return errResponse(err);
  }
}
