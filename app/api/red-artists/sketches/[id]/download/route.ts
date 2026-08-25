import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { listSketches, SketchError } from "@/lib/red-artists/sketches-store";
import { resolveSketchVersionPath } from "@/lib/red-artists/sketch-file-access";
import { errResponse } from "@/lib/red-artists/sketches-http";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

export const maxDuration = 60;

const ID_RE = /^[0-9a-fA-F-]{36}$/;

/**
 * GET /api/red-artists/sketches/[id]/download?v=<n>
 *
 * Same-origin attachment download of ONE of Shalev's sketch versions, path
 * resolved server-side from HIS manifest (see lib/red-artists/sketch-file-access.ts).
 * The id-based sibling of /api/red-artists/download?path=…, needed because a
 * project-linked version's bytes sit under /Projects/… .
 *
 * Audience: owner or shalev — the same as the `?path=` download it mirrors, and
 * the same as the sibling stream route. Nothing arbitrary is accepted: the id
 * must name a sketch in Shalev's own manifest.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireShalevAccess(); if (denied) return denied;

  try {
    const { id } = await params;
    if (!ID_RE.test(id)) throw new SketchError("BAD_INPUT", "מזהה סקיצה לא תקין");

    const sketch = (await listSketches(SHALEV_SLUG)).find((s) => s.id === id);
    if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });

    const resolved = resolveSketchVersionPath(SHALEV_SLUG, sketch, req.nextUrl.searchParams.get("v"));
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

    const base = resolved.fileName;
    const filename = safeDownloadName(base.replace(/\.[^.]+$/, ""), extOf(base));
    return dropboxAttachment(resolved.path, filename);
  } catch (err) {
    return errResponse(err);
  }
}
