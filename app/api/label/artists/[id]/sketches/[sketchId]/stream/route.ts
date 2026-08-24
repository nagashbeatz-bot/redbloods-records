import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { listSketches } from "@/lib/red-artists/sketches-store";
import { resolveSketchVersionPath } from "@/lib/red-artists/sketch-file-access";

/**
 * GET /api/label/artists/[id]/sketches/[sketchId]/stream?v=<n>
 *
 * Audio stream for ONE sketch version, where the Dropbox path is resolved
 * SERVER-SIDE from the manifest — the client sends ids only, never a path.
 *
 * This exists because a project-linked version's bytes live under /Projects/…,
 * outside the artist's own tree, so the generic `?path=` stream route (which
 * hard-restricts to /app/red-artists/{slug}/) rejects it. Widening THAT guard
 * would let any reader stream an arbitrary path they typed — an IDOR. Resolving
 * from the manifest instead keeps the client path-free, exactly the pattern the
 * existing beat/download route already uses.
 *
 * Readable by the owner and by Avi on his OWN id (resolvePortalReadAccess) —
 * unchanged from the generic stream route's audience.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string; sketchId: string }> }) {
  const { id, sketchId } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;

  const sketch = (await listSketches(access.config.slug)).find((s) => s.id === sketchId);
  if (!sketch) return NextResponse.json({ error: "הסקיצה לא נמצאה" }, { status: 404 });

  const vRaw = req.nextUrl.searchParams.get("v");
  const resolved = resolveSketchVersionPath(access.config.slug, sketch, vRaw);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  let token: string;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    token = await getDropboxToken();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dropbox לא מחובר" }, { status: 500 });
  }

  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: resolved.path }),
  });
  if (!res.ok) {
    console.error("[label/artists/[id]/sketches/[sketchId]/stream]", await res.text().catch(() => ""));
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
