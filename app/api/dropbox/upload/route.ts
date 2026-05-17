import { NextRequest, NextResponse } from "next/server";

/**
 * Serialize an object to JSON where every non-ASCII character is escaped as \uXXXX.
 * Required for the Dropbox-API-Arg header — HTTP headers must be pure ASCII.
 */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = process.env.DROPBOX_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "DROPBOX_ACCESS_TOKEN לא מוגדר בסביבה" },
        { status: 500 }
      );
    }

    const formData  = await req.formData();
    const file      = formData.get("file")      as File   | null;
    const projectId = formData.get("projectId") as string | null;
    const newName   = formData.get("newName")   as string | null;

    if (!file || !projectId || !newName) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }

    // Path inside the App Folder (relative to /Apps/<app-name>/)
    const dropboxPath = `/${projectId}/${newName}`;

    // ── 1. Upload to Dropbox ──────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadRes = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization:     `Bearer ${token}`,
          "Content-Type":    "application/octet-stream",
          "Dropbox-API-Arg": dropboxArg({
            path:       dropboxPath,
            mode:       "add",
            autorename: true,
            mute:       false,
          }),
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[dropbox/upload] upload failed:", errText);
      let detail = errText;
      try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded = (await uploadRes.json()) as { path_display: string; name: string };
    const finalPath = uploaded.path_display;

    // ── 2. Build URLs ──────────────────────────────────────────────────────────
    // Internal stream URL (for the in-app player)
    const fileUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

    // ── 3. Create a share token → public player page ──────────────────────────
    // Generate a random token, store it in Supabase settings, return a /share/TOKEN URL.
    // The /share page shows only a minimal audio player — no app access possible.
    let shareUrl = "";
    try {
      const shareToken = crypto.randomUUID().replace(/-/g, "");
      const { supabase } = await import("@/lib/supabase");
      await supabase.from("settings").insert({
        key:   `share_token_${shareToken}`,
        value: { dropboxPath: finalPath, fileName: newName, createdAt: new Date().toISOString() },
      });
      const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
      const base   = domain ? `https://${domain}` : ""; // empty = relative (won't be useful)
      if (base) shareUrl = `${base}/share/${shareToken}`;
    } catch { /* non-fatal */ }

    // ── 4. Persist to Supabase ────────────────────────────────────────────────
    const { addFileToProject } = await import("@/lib/projects-store");
    await addFileToProject(projectId, {
      name:        newName,
      url:         fileUrl,
      dropboxPath: finalPath,
    });

    return NextResponse.json({ ok: true, shareUrl, file: { name: newName, url: fileUrl, dropboxPath: finalPath } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
