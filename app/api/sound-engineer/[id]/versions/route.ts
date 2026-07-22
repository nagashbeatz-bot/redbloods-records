import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listMixVersions } from "@/lib/mix-versions-store";
import { uploadMixVersionFile } from "@/lib/mix-version-upload";

// Large audio files (WAV/FLAC/stems) can take a while.
export const maxDuration = 300;

/** GET /api/sound-engineer/[id]/versions — list mix versions for a work. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const versions = await listMixVersions(id);
    return NextResponse.json({ ok: true, versions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer/[id]/versions — upload a new mix version.
 * Server-side only: Dropbox token never leaves the server. The file goes to the
 * ORIGINAL project's folder under /Mix Versions/ (work_title is NEVER used for
 * the path). Metadata is stored ONLY in mix_versions — never projects.files, and
 * NO public share link is created. The upload core lives in lib/mix-version-upload
 * so this owner route and the scoped supplier route share one tested path.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;

    const form  = await req.formData();
    const file  = form.get("file") as File | null;
    const label = ((form.get("label") as string | null) ?? "").trim();
    const addToExisting = form.get("addToExisting") != null;
    const roleParam     = form.get("role") as string | null;
    const durationRaw    = form.get("durationSeconds") as string | null;
    const durationParsed = durationRaw != null ? Number(durationRaw) : NaN;
    const durationSeconds = Number.isFinite(durationParsed) && durationParsed > 0 ? Math.round(durationParsed) : null;

    const result = await uploadMixVersionFile(workId, {
      file: file as File, label, addToExisting, roleParam, durationSeconds,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, version: result.version });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/versions POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
