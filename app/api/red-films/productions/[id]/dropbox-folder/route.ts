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
import { supabase } from "@/lib/supabase";
import { createDropboxFolder, getOrCreateFolderShareLink } from "@/lib/dropbox-folder";
import { getDropboxToken } from "@/lib/dropbox-token";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: productionId } = await ctx.params;

    const token    = await getDropboxToken();
    const basePath = `/Red Films/Productions/${productionId}`;

    await createDropboxFolder(token, basePath);
    await createDropboxFolder(token, `${basePath}/references`);
    await createDropboxFolder(token, `${basePath}/documents`);

    const folderUrl = await getOrCreateFolderShareLink(token, basePath);

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("red_films_productions")
      .update({
        dropbox_folder_path: basePath,
        dropbox_folder_url:  folderUrl,
        updated_at:          now,
      })
      .eq("id", productionId);

    if (error) throw error;

    return NextResponse.json({ ok: true, folderPath: basePath, folderUrl });
  } catch (e) {
    console.error("[POST /api/red-films/productions/[id]/dropbox-folder]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
