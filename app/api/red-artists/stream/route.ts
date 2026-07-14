import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";

/**
 * GET /api/red-artists/stream?path=/app/red-artists/shalev-tasama/...
 *
 * Scoped audio stream for the artist portal (owner or shalev). Unlike the raw
 * /api/dropbox/stream (arbitrary path → any Dropbox file), this endpoint is
 * guarded AND hard-restricted to Shalev's own folder tree, so opening the portal
 * to the shalev role can never expose another project's/artist's files.
 */
const ALLOWED_PREFIX = "/app/red-artists/shalev-tasama/";

export async function GET(req: NextRequest) {
  const denied = await requireShalevAccess();
  if (denied) return denied;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path נדרש" }, { status: 400 });
  // Hard scope: only files inside Shalev's own tree; no traversal.
  if (path.includes("..") || !path.startsWith(ALLOWED_PREFIX)) {
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
    console.error("[red-artists/stream]", await res.text().catch(() => ""));
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302); // audio element follows to Dropbox CDN
}
