import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";

export const maxDuration = 60;

// GET /api/red-artists/download?path=/app/red-artists/shalev-tasama/...
//
// Same-origin attachment download for the artist portal (owner or shalev). HARD-
// scoped to Shalev's own folder tree (identical guard to /api/red-artists/stream),
// so it can never serve another artist's/project's file. The filename is the file's
// own clean basename (e.g. "My Mind V1.mp3") — no token/UUID. No 302, no temp link.
const ALLOWED_PREFIX = "/app/red-artists/shalev-tasama/";

export async function GET(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  if (path.includes("..") || !path.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const base = path.split("/").pop() || "audio";
  const filename = safeDownloadName(base.replace(/\.[^.]+$/, ""), extOf(base));
  return dropboxAttachment(path, filename);
}
