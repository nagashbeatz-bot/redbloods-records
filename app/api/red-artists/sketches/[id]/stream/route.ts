import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { listSketches, SketchError } from "@/lib/red-artists/sketches-store";
import { resolveSketchVersionPath } from "@/lib/red-artists/sketch-file-access";
import { errResponse } from "@/lib/red-artists/sketches-http";
import { SHALEV_SLUG } from "@/lib/red-artists/portal-config";

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks path traversal / arbitrary ids

/**
 * GET /api/red-artists/sketches/[id]/stream?v=<n>
 *
 * Audio stream for ONE of Shalev's sketch versions, where the Dropbox path is
 * resolved SERVER-SIDE from HIS manifest — the client sends ids only, never a
 * path. The id-based sibling of /api/red-artists/stream?path=…
 *
 * This exists because a PROJECT-LINKED version's bytes live under /Projects/…,
 * outside Shalev's own tree, so the `?path=` route (hard-restricted to
 * /app/red-artists/shalev-tasama/) rejects it — correctly. Widening THAT guard
 * would let any reader stream an arbitrary /Projects path they typed (an IDOR),
 * so it stays exactly as strict as it is. Resolving from the manifest instead
 * means Shalev can only ever reach a file HIS OWN library already references,
 * put there by the owner-gated project-link route.
 *
 * Audience: owner or shalev (requireShalevAccess) — identical to the `?path=`
 * route it mirrors. Always SHALEV_SLUG; no artist parameter exists.
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
      console.error("[red-artists/sketches/[id]/stream]", await res.text().catch(() => ""));
      return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
    }
    const data = (await res.json()) as { link: string };
    return NextResponse.redirect(data.link, 302); // audio element follows to Dropbox CDN
  } catch (err) {
    return errResponse(err);
  }
}
