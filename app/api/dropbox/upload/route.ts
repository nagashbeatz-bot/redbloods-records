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

    // Public share URL — get a temporary direct link from Dropbox (4h TTL).
    // Hosted on Dropbox CDN, does NOT expose our app domain.
    let shareUrl = "";
    try {
      const tmpRes = await fetch(
        "https://api.dropboxapi.com/2/files/get_temporary_link",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: finalPath }),
        }
      );
      if (tmpRes.ok) {
        const tmpData = (await tmpRes.json()) as { link: string };
        shareUrl = tmpData.link;
      }
    } catch { /* non-fatal — share popup just won't open */ }

    // ── 3. Persist to Supabase ────────────────────────────────────────────────
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
