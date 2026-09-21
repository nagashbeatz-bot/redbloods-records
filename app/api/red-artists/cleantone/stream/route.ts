import { NextRequest, NextResponse } from "next/server";
import { requireCleantoneAccess } from "@/lib/require-auth";
import { isPathWithinArtist } from "@/lib/red-artists/portal-files";
import { CLEANTONE_NAME, slugForPortalArtistName } from "@/lib/red-artists/portal-registry";

/**
 * GET /api/red-artists/cleantone/stream?path=/app/red-artists/dj-cleantone/...
 *
 * Scoped file stream for DJ CLEANTONE's OWN session (owner or cleantone) — the
 * mirror of /api/red-artists/stream (Shalev), used to load his profile image +
 * its original. HARD-restricted to his own folder tree, so it can never expose
 * another artist's/project's files. Allowed by the proxy's existing
 * "/api/red-artists/cleantone" prefix.
 */
const CLEANTONE_SLUG = slugForPortalArtistName(CLEANTONE_NAME) as string;

export async function GET(req: NextRequest) {
  const denied = await requireCleantoneAccess();
  if (denied) return denied;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  if (!isPathWithinArtist(CLEANTONE_SLUG, path)) {
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
    console.error("[red-artists/cleantone/stream]", await res.text().catch(() => ""));
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
