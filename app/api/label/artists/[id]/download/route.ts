import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";
import { isPathWithinArtist } from "@/lib/red-artists/portal-files";

export const maxDuration = 60;

// GET /api/label/artists/[id]/download?path=/app/red-artists/{slug}/...
//
// Owner-only same-origin attachment download for THIS artist's own portal
// preview. HARD-scoped to this artist's own folder tree (identical guard to
// the stream route above).
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  if (!isPathWithinArtist(access.config.slug, path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const base = path.split("/").pop() || "audio";
  const filename = safeDownloadName(base.replace(/\.[^.]+$/, ""), extOf(base));
  return dropboxAttachment(path, filename);
}
