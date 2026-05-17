import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

// POST /api/delivery/upload
// FormData: { file: File, projectId: string }
export async function POST(req: NextRequest) {
  let token: string;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    token = await getDropboxToken();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dropbox לא מחובר" }, { status: 500 });
  }

  const formData  = await req.formData();
  const file      = formData.get("file")      as File   | null;
  const projectId = formData.get("projectId") as string | null;

  if (!file || !projectId) {
    return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
  }

  // Get delivery folder path from settings
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `delivery_${projectId}`)
    .maybeSingle();

  const val        = (data?.value ?? {}) as Record<string, unknown>;
  const folderPath = val.folderPath as string | undefined;

  if (!folderPath) {
    return NextResponse.json(
      { error: "לא נוצרה תיקיית מסירה לפרויקט זה" },
      { status: 400 }
    );
  }

  // Use overwrite mode so re-uploading the same filename replaces the old version
  const uploadPath = `${folderPath}/${file.name}`;
  const buffer     = Buffer.from(await file.arrayBuffer());

  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization:     `Bearer ${token}`,
      "Content-Type":    "application/octet-stream",
      "Dropbox-API-Arg": dropboxArg({
        path:       uploadPath,
        mode:       "overwrite",
        autorename: false,
        mute:       false,
      }),
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("[delivery/upload] Dropbox error:", errText);
    let detail = errText;
    try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
    return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
  }

  const uploaded = (await uploadRes.json()) as { path_display: string; name: string };

  return NextResponse.json({
    ok:   true,
    file: { name: uploaded.name, path: uploaded.path_display },
  });
}
