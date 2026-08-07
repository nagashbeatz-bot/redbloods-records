import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { listSketches } from "@/lib/red-artists/sketches-store";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";
import { isPathWithinArtist } from "@/lib/red-artists/portal-files";

export const maxDuration = 60;

// GET /api/label/artists/[id]/beat/download?sketchId=<uuid>
//
// Same-origin attachment download of a project's companion BEAT only. Unlike the
// generic owner-only /download route, this is reachable by the artist reading
// their OWN portal (Avi) via resolvePortalReadAccess — so he can take the beat
// home to work on it. Deliberately NARROW: it resolves the path server-side from
// the sketch's own `beat` (a client-sent path is never trusted) and re-checks it
// is inside this artist's folder tree, so it can only ever return a beat file.
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;

  const sketchId = req.nextUrl.searchParams.get("sketchId");
  if (!sketchId) return NextResponse.json({ error: "sketchId נדרש" }, { status: 400 });

  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch?.beat?.filePath) return NextResponse.json({ error: "אין ביט לפרויקט זה" }, { status: 404 });

  const path = sketch.beat.filePath;
  if (!isPathWithinArtist(access.config.slug, path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const base = path.split("/").pop() || "beat";
  const filename = safeDownloadName(base.replace(/\.[^.]+$/, ""), extOf(base));
  return dropboxAttachment(path, filename);
}
