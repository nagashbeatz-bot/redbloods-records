import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requireShalevAccess } from "@/lib/require-auth";
import { getNextReleaseConfig, setNextReleaseConfig } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

// GET /api/red-artists/next-release — the portal's chosen next release (from the
// manifest; resolved against the live sketches). null when unset. Readable by the
// artist (shalev) so his home card populates; only the owner may SET it (POST).
export async function GET() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const release = await getNextReleaseConfig();
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/red-artists/next-release — set it. body: { sketchId, releaseDate }.
// sketchId MUST be an active sketch from the manifest (never a Project id).
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const release = await setNextReleaseConfig(String(body.sketchId ?? ""), String(body.releaseDate ?? ""));
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    return errResponse(err);
  }
}
