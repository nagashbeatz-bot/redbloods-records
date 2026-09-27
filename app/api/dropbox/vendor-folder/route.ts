import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * POST /api/dropbox/vendor-folder
 * Creates a vendor folder structure in Dropbox and returns a share link.
 *
 * Legacy body (ProjectDrawer / VictorDrawer): { vendorName, artistName, projectName }
 *   Folder structure created:
 *     /{vendorName}/{artistName} - {projectName}/{01_From_Redbloods,02_From_{VendorName},03_Approved,Production}
 *
 * Projects-layout body (/team/victor only): { vendorName, useProjectsLayout: true,
 *   projectId, projectName, artistName, workTitle, workId }
 *   Organizes Victor files under the existing /Projects convention instead:
 *     linked (has projectId): /Projects/{primaryArtist}/{projectName}/Victor/...
 *     Victor-only (no projectId): /Projects/Victor/{workTitle || vendor_work_<id>}/...
 *
 * Returns: { ok, folderPath, shareLink }
 */

export async function POST(req: Request) {
  // Owner only: it builds folders from client-sent artist / project names and returns a PUBLIC folder link.
  // Victor never needs it (his uploads resolve the work folder server-side from the workId).
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json() as {
      vendorName:        string;
      artistName?:       string;
      projectName?:      string;
      // Projects-layout fields (/team/victor only) — absent for legacy callers.
      useProjectsLayout?: boolean;
      projectId?:        string | null;
      workTitle?:        string | null;
      workId?:           string | null;
    };

    const { vendorName } = body;
    // Scope to Victor's vendor tree only (single supplier in Phase 2A).
    if ((vendorName ?? "").trim().toLowerCase() !== "victor") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { victorFolderBasePath, buildVictorFolderTree } = await import("@/lib/writes/victor");
    if (!body.useProjectsLayout && (!body.artistName || !body.projectName)) {
      return NextResponse.json({ ok: false, error: "חסרים שדות: vendorName, artistName, projectName" }, { status: 400 });
    }
    const basePath = victorFolderBasePath(body);
    // shared writer (lib/writes/victor): the four sub-folders + a PUBLIC folder link
    const shareLink = await buildVictorFolderTree(vendorName, basePath);

    return NextResponse.json({ ok: true, folderPath: basePath, shareLink });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "׳©׳’׳™׳׳× ׳©׳¨׳×";
    console.error("[dropbox/vendor-folder]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
