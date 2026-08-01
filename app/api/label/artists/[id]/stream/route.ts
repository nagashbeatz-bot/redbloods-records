import { NextRequest, NextResponse } from "next/server";
import { resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { isPathWithinArtist } from "@/lib/red-artists/portal-files";

/**
 * GET /api/label/artists/[id]/stream?path=/app/red-artists/{slug}/...
 *
 * Owner-only scoped audio stream for THIS artist's own portal preview.
 * HARD-restricted to this artist's own folder tree — resolved server-side
 * from the URL id, never trusted from the client — so it can never expose
 * another artist's/project's files.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  if (!isPathWithinArtist(access.config.slug, path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    console.error("[label/artists/[id]/stream]", await res.text().catch(() => ""));
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
