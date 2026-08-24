import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { listSketches } from "@/lib/red-artists/sketches-store";
import { resolveSketchVersionPath } from "@/lib/red-artists/sketch-file-access";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";

export const maxDuration = 60;

/**
 * GET /api/label/artists/[id]/sketches/[sketchId]/download?v=<n>
 *
 * Same-origin attachment download of ONE sketch version, path resolved
 * server-side from the manifest (see lib/red-artists/sketch-file-access.ts).
 * The id-based sibling of the generic `?path=` download route, needed because a
 * project-linked version's bytes sit under /Projects/… .
 *
 * OWNER-ONLY, exactly like the generic /download it mirrors — Avi's download
 * surface is unchanged (he still only has beat/download).
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;

  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });

  const resolved = resolveSketchVersionPath(access.config.slug, sketch, req.nextUrl.searchParams.get("v"));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const base = resolved.fileName;
  const filename = safeDownloadName(base.replace(/\.[^.]+$/, ""), extOf(base));
  return dropboxAttachment(resolved.path, filename);
}
