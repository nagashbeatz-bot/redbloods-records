import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listBeats } from "@/lib/beats-store";
import { uploadBeatSingle } from "@/lib/beat-upload";

// OWNER-ONLY "free beats" pool. Never exposed to the shalev portal — requireOwner
// on every method (defense-in-depth on top of the proxy gate).

export const maxDuration = 300;

// GET /api/beats → { beats } (available beats, newest first). Each beat exposes a
// same-origin stream URL for the global player (never a raw Dropbox path).
export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const beats = await listBeats();
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
    return NextResponse.json({ ok: true, beat: res.beat });
  } catch (err) {
    console.error("[beats] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
  }
}
