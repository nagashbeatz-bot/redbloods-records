import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess } from "@/lib/require-auth";

/**
 * GET /api/vendor/victor/stream?path=<dropboxPath>
 *
 * Scoped audio streaming for the Victor page. Unlike /api/dropbox/stream (owner
 * only, via the gate), this route lives under the victor-allowed API prefix so
 * Victor can play HIS OWN files — and ONLY his own files:
 *   - requireVictorAccess (owner or victor; anyone else 403 at the gate/route)
 *   - the requested `path` must belong to one of Victor's works
 *     (filesSent / filesReceived). Arbitrary Dropbox paths, path traversal, or
 *     other projects' files are rejected with 403.
 *
 * No new public share links are created; it returns a short-lived temporary
 * link and 302-redirects the <audio> element to it.
 */
export async function GET(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const path = sp.get("path");
  const workId = sp.get("workId");
  const fileRef = sp.get("fileRef");

  // Resolve the real Dropbox path server-side. Two accepted forms:
  //   • workId + fileRef  → opaque handle (Victor never holds a path). Resolved
  //     ONLY against that work's own files, so it can't reach anything else.
  //   • path              → legacy form, still scoped to Victor's own files.
  let target: string | null = null;
  if (fileRef && workId) {
    const { getVictorWorkById } = await import("@/lib/vendor-store");
    const { resolveVictorFileRef } = await import("@/lib/victor-files");
    const work = await getVictorWorkById(workId);
    if (work && work.vendorName === "victor") target = resolveVictorFileRef(work, fileRef);
  } else if (path) {
    const { getVictorWork } = await import("@/lib/vendor-store");
    const works = await getVictorWork();
    for (const w of works) {
      for (const f of [...(w.filesSent ?? []), ...(w.filesReceived ?? []), ...(w.briefFiles ?? [])]) {
        if (f.dropboxPath === path) { target = path; break; }
      }
      if (target) break;
    }
  }
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
    console.error("[vendor/victor/stream]", await res.text());
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
