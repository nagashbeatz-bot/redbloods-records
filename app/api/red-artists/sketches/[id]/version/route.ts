import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { addVersion, validateAudio, SketchError } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";
import { notifySketchUpdated } from "@/lib/red-artists/sketches-notify";

export const maxDuration = 300;
const ID_RE = /^[0-9a-fA-F-]{36}$/;

// POST /api/red-artists/sketches/[id]/version — upload a new version (V{n+1}) for an
// existing sketch. multipart form: file (required audio). Previous versions are kept.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!ID_RE.test(id)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");
    const form = await req.formData();
    const audio = await validateAudio(form.get("file") as File | null);
    const sketch = await addVersion(id, audio);
    // Push Shalev + (only on a real send) an owner ack — ONLY now that the file
    // is uploaded and the manifest write has fully succeeded.
    await notifySketchUpdated(sketch.id, sketch.latestVersion, sketch.title);
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}
