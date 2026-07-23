import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { updateBeatFile, deleteBeatFully } from "@/lib/beat-upload";
import { notifyBeatUpdated } from "@/lib/beat-notify";

// OWNER-ONLY beat management. Both methods requireOwner (never exposed to shalev).

export const maxDuration = 300;

const ID_RE = /^[0-9a-fA-F-]{36}$/;

// PATCH /api/beats/[id] — replace the beat's file (new upload) + name/genre, same id.
// multipart form: file (audio, required), name, genre.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!ID_RE.test(id)) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const name = (form.get("name") as string | null) ?? "";
    const genre = (form.get("genre") as string | null) ?? "";
    const musicalKey = (form.get("musicalKey") as string | null) ?? "";
    const res = await updateBeatFile({ beatId: id, file, name, genre, musicalKey });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    // Push owner + shalev — ONLY now that the update (metadata, or file + DB) succeeded.
    await notifyBeatUpdated(res.beat);
    return NextResponse.json({ ok: true, beat: res.beat });
  } catch (err) {
    console.error("[beats] PATCH", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
  }
}

// DELETE /api/beats/[id] — remove the beat's current file (guarded to /nagashbeatz/beats)
// and its row. Old files from prior updates are left untouched.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!ID_RE.test(id)) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
    const res = await deleteBeatFully(id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[beats] DELETE", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
  }
}
