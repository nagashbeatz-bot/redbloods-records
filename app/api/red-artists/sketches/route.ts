import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { listSketches, createSketch, validateAudio } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";
import { notifyNewSketch } from "@/lib/red-artists/sketches-notify";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

export const maxDuration = 300;

// GET /api/red-artists/sketches — Shalev's OWN standalone music library
// (manifest-backed). Unchanged: always his own slug, never another artist's.
export async function GET() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const sketches = await listSketches(SHALEV_SLUG);
    return NextResponse.json({ ok: true, sketches });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/red-artists/sketches — create a new sketch (V1). multipart form:
//   title (required), description?, notes?, file (required audio).
export async function POST(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const form = await req.formData();
    const title = (form.get("title") as string | null) ?? "";
    const description = (form.get("description") as string | null) ?? "";
    const notes = (form.get("notes") as string | null) ?? "";
    const audio = await validateAudio(form.get("file") as File | null);
    const sketch = await createSketch(SHALEV_SLUG, { title, description, notes, audio });
    // Push Shalev + (only on a real send) an owner ack — ONLY now that the file
    // is uploaded and the manifest write has fully succeeded.
    await notifyNewSketch(sketch.id, sketch.title);
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}
