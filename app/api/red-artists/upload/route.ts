import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { uploadArtistFile, type UploadKind } from "@/lib/red-artists/portal-files";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

/**
 * POST /api/red-artists/upload
 *
 * OWNER ONLY. Uploads a single file into ONE of Shalev's OWN two server-owned
 * artist folders, chosen by an approved `kind` — the client NEVER sends a path.
 *
 *   kind=performance → /app/red-artists/shalev-tasama/performance-files  (audio only)
 *   kind=pressKit    → /app/red-artists/shalev-tasama/press-kit          (images / docs)
 *
 * No DB, no metadata, no share-token, no /Projects coupling. Single-shot
 * upload (no chunked in this phase).
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const form = await req.formData();
    const kind = form.get("kind") as string | null;
    if (kind !== "performance" && kind !== "pressKit") {
      return NextResponse.json({ error: "סוג העלאה לא תקין" }, { status: 400 });
    }
    const result = await uploadArtistFile(SHALEV_SLUG, kind as UploadKind, form.get("file") as File | null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, kind, file: result.file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
