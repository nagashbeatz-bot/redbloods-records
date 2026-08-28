import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
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
 * Reachable by the owner (any artist) OR a restricted portal artist reading his
 * OWN page — the same audience as the sibling /stream route, so an artist who may
 * PLAY his song may also save it out of the player. Shalev's equivalent
 * (/api/red-artists/sketches/[id]/download) already worked this way.
 *
 * Scoping is what makes that safe, and none of it is new: resolvePortalReadAccess
 * pins a non-owner to his own artist id, the sketch is then looked up in THAT
 * artist's manifest (another artist's sketch id is simply absent → 404), and the
 * path comes out of the manifest rather than the client. The generic
 * `${base}/download?path=` stays owner-only precisely because it does take a
 * client-supplied path.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;

  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });

  const resolved = resolveSketchVersionPath(access.config.slug, sketch, req.nextUrl.searchParams.get("v"));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const base = resolved.fileName;
  const filename = safeDownloadName(base.replace(/\.[^.]+$/, ""), extOf(base));
  return dropboxAttachment(resolved.path, filename);
}
