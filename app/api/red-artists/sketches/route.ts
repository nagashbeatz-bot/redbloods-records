import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listSketches, createSketch, validateAudio } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

export const maxDuration = 300;

// GET /api/red-artists/sketches — the artist's standalone music library (manifest-backed).
export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const sketches = await listSketches();
    return NextResponse.json({ ok: true, sketches });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/red-artists/sketches — create a new sketch (V1). multipart form:
//   title (required), description?, notes?, file (required audio).
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const form = await req.formData();
    const title = (form.get("title") as string | null) ?? "";
    const description = (form.get("description") as string | null) ?? "";
    const notes = (form.get("notes") as string | null) ?? "";
    const audio = await validateAudio(form.get("file") as File | null);
    const sketch = await createSketch({ title, description, notes, audio });
    return NextResponse.json({ ok: true, sketch });
  } catch (err) {
    return errResponse(err);
  }
}
