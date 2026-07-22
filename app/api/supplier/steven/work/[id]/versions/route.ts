import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { listMixVersions } from "@/lib/mix-versions-store";
import { uploadMixVersionFile } from "@/lib/mix-version-upload";
import { assertStevenOwnsWork, sanitizeVersionForSteven } from "@/lib/steven-scope";

// Large audio files (WAV/FLAC/stems) can take a while.
export const maxDuration = 300;

const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

/** GET /api/supplier/steven/work/[id]/versions — Steven's own work's versions,
 *  with opaque stream URLs (no raw Dropbox path). 403 for any non-Steven work. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id } = await params;
    if (!(await assertStevenOwnsWork(id))) return FORBID();
    const versions = (await listMixVersions(id)).map(sanitizeVersionForSteven);
    return NextResponse.json({ ok: true, versions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST — Steven uploads a new version / adds a file to an existing one, ONLY on
 *  his own work. Same upload core as the owner route; response is sanitized. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const work = await assertStevenOwnsWork(workId);
    if (!work) return FORBID();

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

    // Best-effort owner push (coalesced ~75s into one summary). NEVER fail the upload.
    try {
      const { queueStevenUploadNotice } = await import("@/lib/steven-notify");
      await queueStevenUploadNotice(workId, work.projectName, {
        name:  result.version.fileName,
        role:  roleParam || null,
        label: result.version.label,
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, version: sanitizeVersionForSteven(result.version) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[supplier/steven/versions POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
