import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { uploadArtistFile, type UploadKind } from "@/lib/red-artists/portal-files";

/**
 * POST /api/label/artists/[id]/upload
 *
 * Owner-only preview upload into ONE of this artist's OWN server-owned
 * folders, chosen by an approved `kind` — the client never sends a path.
 *   kind=performance → .../performance-files  (audio only)
 *   kind=pressKit    → .../press-kit          (images / docs)
 */
export const maxDuration = 300;

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const form = await req.formData();
    const kind = form.get("kind") as string | null;
    if (kind !== "performance" && kind !== "pressKit") {
      return NextResponse.json({ error: "סוג העלאה לא תקין" }, { status: 400 });
    }
    const result = await uploadArtistFile(access.config.slug, kind as UploadKind, form.get("file") as File | null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, kind, file: result.file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
