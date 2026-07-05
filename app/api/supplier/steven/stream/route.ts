import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { assertStevenOwnsWork, assertStevenOwnsVersion } from "@/lib/steven-scope";

const WM_CATEGORY = "חומרי עבודה";
const FORBID = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

/**
 * GET /api/supplier/steven/stream — scoped audio streaming for Steven. Two opaque
 * forms, both resolved to a real Dropbox path SERVER-SIDE and only if the target
 * belongs to a Steven work (mirror of the Victor stream):
 *   • ?versionId=<uuid>          → a mix version file on Steven's own work.
 *   • ?workId=<uuid>&name=<file> → a work-material file in that work's project.
 * Steven never holds a Dropbox path; arbitrary paths / traversal / other works
 * are rejected with 403. Returns a short-lived temp link via 302 (no share link).
 */
export async function GET(req: NextRequest) {
  const denied = await requireStevenAccess(); if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const versionId = sp.get("versionId");
  const workId    = sp.get("workId");
  const name      = sp.get("name");

  let target: string | null = null;

  if (versionId) {
    const owned = await assertStevenOwnsVersion(versionId);
    if (owned?.version.dropboxPath) target = owned.version.dropboxPath;
  } else if (workId && name) {
    const work = await assertStevenOwnsWork(workId);
    if (work?.projectId) {
      const { getProject } = await import("@/lib/projects-store");
      const project = await getProject(work.projectId);
      const files = (project?.files ?? []) as { name?: string; dropboxPath?: string; category?: string }[];
      const match = files.find((f) => f.category === WM_CATEGORY && (f.name ?? "") === name && f.dropboxPath);
      if (match?.dropboxPath) target = match.dropboxPath;
    }
  }

  if (!target) return FORBID();

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
    console.error("[supplier/steven/stream]", await res.text());
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
