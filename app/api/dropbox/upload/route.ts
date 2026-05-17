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
          // dropboxArg() ensures all Hebrew/Unicode chars are \uXXXX-escaped
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
      // Return the actual Dropbox error so we can debug
      let detail = errText;
      try { detail = JSON.parse(errText)?.error_summary ?? errText; } catch {}
      return NextResponse.json({ error: `Dropbox: ${detail}` }, { status: 500 });
    }

    const uploaded = (await uploadRes.json()) as {
      path_display: string;
      name: string;
    };
    // Use the actual path Dropbox chose (may differ if autorename kicked in)
    const finalPath = uploaded.path_display;

    // ── 2. Build the internal stream URL (for the in-app player) ─────────────
    const fileUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

    // ── 3. Create a public shared link (for sharing with clients) ─────────────
    let shareUrl = "";
    try {
      const linkRes = await fetch(
        "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: finalPath, settings: { requested_visibility: "public" } }),
        }
      );
      if (linkRes.ok) {
        const linkData = (await linkRes.json()) as { url: string };
        // Convert ?dl=0 → ?dl=1 for direct download/playback
        shareUrl = linkData.url.replace(/\?dl=0$/, "?dl=1");
      } else {
        // Link might already exist — try fetching it
        const existing = await fetch(
          "https://api.dropboxapi.com/2/sharing/list_shared_links",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ path: finalPath, direct_only: true }),
          }
        );
        if (existing.ok) {
          const ed = (await existing.json()) as { links?: { url: string }[] };
          if (ed.links?.[0]?.url) shareUrl = ed.links[0].url.replace(/\?dl=0$/, "?dl=1");
        }
      }
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
