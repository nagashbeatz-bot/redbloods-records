import { NextRequest, NextResponse } from "next/server";
import { requireOwner, getAuthRole } from "@/lib/require-auth";
import { listBeats } from "@/lib/beats-store";
import { beatScopeForRole } from "@/lib/beat-scope";
import { uploadBeatSingle } from "@/lib/beat-upload";
import { notifyBeatUploaded } from "@/lib/beat-notify";

// The canonical beat repository. READING is open to the owner (whole repository)
// and to an artist portal (ONLY that artist's assigned beats). WRITING
// (POST/PATCH/DELETE) stays owner-only. Guards are re-checked per method here on
// top of the proxy gate.

export const maxDuration = 300;

// GET /api/beats            → the central repository (owner only)
// GET /api/beats?artist=... → one artist's assigned beats
//
// The scope is decided from the CALLER'S ROLE, never taken on trust: an artist
// role is pinned to its own slug and the ?artist= parameter is ignored for them,
// so no artist can read another artist's beats or the whole repository. Only the
// owner may pass ?artist= (they preview artist portals). Each beat exposes a
// same-origin stream URL for the global player (never a raw Dropbox path).
export async function GET(req: NextRequest) {
  const role = await getAuthRole();
  const scope = beatScopeForRole(role, req.nextUrl.searchParams.get("artist"));
  if (scope.kind === "denied") {
    return NextResponse.json({ error: scope.reason }, { status: scope.status });
  }
  try {
    const beats = await listBeats(scope.artistSlug);
    return NextResponse.json({
      ok: true,
      beats: beats.map((b) => ({
        id: b.id,
        name: b.name,
        genre: b.genre,
        musicalKey: b.musicalKey,
        durationSeconds: b.durationSeconds,
        createdAt: b.createdAt,
        url: `/api/beats/${b.id}/stream`,
      })),
    });
  } catch (err) {
    console.error("[beats] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
  }
}

// POST /api/beats — upload a beat. multipart form: file (audio), name, genre.
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const name = (form.get("name") as string | null) ?? "";
    const genre = (form.get("genre") as string | null) ?? "";
    const musicalKey = (form.get("musicalKey") as string | null) ?? "";
    const res = await uploadBeatSingle({ file, name, genre, musicalKey });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    // Push owner + shalev — ONLY now that Dropbox + DB have succeeded.
    await notifyBeatUploaded(res.beat);
    return NextResponse.json({ ok: true, beat: res.beat });
  } catch (err) {
    console.error("[beats] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
  }
}
