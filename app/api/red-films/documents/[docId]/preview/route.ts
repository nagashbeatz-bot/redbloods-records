/**
 * GET /api/red-films/documents/[docId]/preview
 * Fetches the document from Dropbox and serves it with Content-Disposition: inline
 * so the browser renders it in-place (e.g. PDF in iframe) instead of forcing a download.
 * Does NOT affect /api/dropbox/stream which is used for audio.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";

export const maxDuration = 60;

type Ctx = { params: Promise<{ docId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { docId } = await ctx.params;

    const { data: doc } = await supabase
      .from("red_films_documents")
      .select("dropbox_path, file_name, mime_type")
      .eq("id", docId)
      .maybeSingle();

    if (!doc) return new NextResponse("מסמך לא נמצא", { status: 404 });

    const token = await getDropboxToken();

    const linkRes = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: doc.dropbox_path }),
    });

    if (!linkRes.ok) {
      return new NextResponse("שגיאה בקבלת קישור Dropbox", { status: 502 });
    }

    const { link } = (await linkRes.json()) as { link: string };

    const fileRes = await fetch(link);
    if (!fileRes.ok || !fileRes.body) {
      return new NextResponse("שגיאה בטעינת הקובץ", { status: 502 });
    }

    const contentType = (doc.mime_type as string) || "application/pdf";
    const safeName    = (doc.file_name as string).replace(/"/g, "");

    return new NextResponse(fileRes.body, {
      status: 200,
      headers: {
        "Content-Type":        contentType,
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control":       "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("[GET /api/red-films/documents/[docId]/preview]", e);
    return new NextResponse("שגיאת שרת", { status: 500 });
  }
}
