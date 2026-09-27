/**
 * POST /api/red-films/productions/[id]/dropbox-folder
 * Creates the production's Dropbox folder structure and saves the share link to DB.
 *
 * Folder structure:
 *   /Red Films/Productions/{production_id}/
 *   /Red Films/Productions/{production_id}/references/
 *   /Red Films/Productions/{production_id}/documents/
 */
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;

    // shared writer (lib/writes/redfilms): folder tree + public link, saved on the production
    const { createProductionFolder } = await import("@/lib/writes/redfilms");
    const { basePath, folderUrl } = await createProductionFolder(productionId);

    return NextResponse.json({ ok: true, folderPath: basePath, folderUrl });
  } catch (e) {
    console.error("[POST /api/red-films/productions/[id]/dropbox-folder]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
