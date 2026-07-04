import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess } from "@/lib/require-auth";

/**
 * GET /api/vendor/victor/download?workId=…&fileRef=…
 *
 * Scoped download for the Victor view. Resolves the opaque fileRef to a real
 * Dropbox path SERVER-SIDE, only within the given work's own files, then
 * 302-redirects to a short-lived Dropbox temporary link. Victor never receives
 * a path or a public share link. Owner may use it too (owner also has the
 * legacy public links). Same ownership boundary as the stream route.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const workId = sp.get("workId");
  const fileRef = sp.get("fileRef");
  if (!workId || !fileRef) return NextResponse.json({ error: "workId + fileRef נדרשים" }, { status: 400 });

  const { getVictorWorkById } = await import("@/lib/vendor-store");
  const { resolveVictorFileRef } = await import("@/lib/victor-files");
  const work = await getVictorWorkById(workId);
  const target = work && work.vendorName === "victor" ? resolveVictorFileRef(work, fileRef) : null;
  if (!target) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
    body: JSON.stringify({ path: target }),
  });
  if (!res.ok) {
    console.error("[vendor/victor/download]", await res.text());
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
