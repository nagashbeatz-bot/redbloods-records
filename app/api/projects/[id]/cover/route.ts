import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getProject } from "@/lib/projects-store";
import { isCoverThemeId, isSafeProjectId, looksLikeJpeg } from "@/lib/project-cover";
import {
  MAX_COVER_BYTES,
  saveThemeCover, saveImageCover, resetProjectCover,
} from "@/lib/project-cover-store";

/**
 * Project Cover ("תמונת נושא") — OWNER-ONLY writes. Artists never reach this route:
 * the proxy keeps it off every artist allowlist and requireOwner re-checks here.
 *   PUT  json      { theme }        → pick a theme (drops any custom image)
 *   PUT  multipart file (JPEG)      → custom image (client already resized to ~1200px)
 *   DELETE                          → back to the default cover
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function resolveProject(ctx: Ctx): Promise<{ id: string } | NextResponse> {
  const { id } = await ctx.params;
  if (!isSafeProjectId(id)) return NextResponse.json({ error: "מזהה פרויקט לא תקין" }, { status: 400 });
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });
  return { id };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const p = await resolveProject(ctx);
    if (p instanceof NextResponse) return p;

    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "חסר קובץ" }, { status: 400 });
      if (file.size > MAX_COVER_BYTES) return NextResponse.json({ error: "הקובץ גדול מדי" }, { status: 413 });
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!looksLikeJpeg(bytes)) return NextResponse.json({ error: "התמונה צריכה להיות JPEG" }, { status: 400 });
      const cover = await saveImageCover(p.id, bytes);
      return NextResponse.json({ ok: true, cover });
    }

    const body = (await req.json().catch(() => ({}))) as { theme?: unknown };
    if (!isCoverThemeId(body.theme)) return NextResponse.json({ error: "סגנון לא מוכר" }, { status: 400 });
    const cover = await saveThemeCover(p.id, body.theme);
    return NextResponse.json({ ok: true, cover });
  } catch (err) {
    console.error("[projects/cover PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שמירת תמונת הנושא נכשלה" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!isSafeProjectId(id)) return NextResponse.json({ error: "מזהה פרויקט לא תקין" }, { status: 400 });
    await resetProjectCover(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[projects/cover DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "איפוס תמונת הנושא נכשל" }, { status: 500 });
  }
}
