import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const { dropboxPath, projectId } = await req.json();

    if (!dropboxPath || typeof dropboxPath !== "string") {
      return NextResponse.json({ error: "dropboxPath נדרש" }, { status: 400 });
    }
    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId נדרש" }, { status: 400 });
    }

    // ── 0. Un-link the artist's library FIRST ────────────────────────────────
    // A file uploaded here can be REFERENCED by a version in a portal artist's
    // "המוזיקה שלי" manifest (one physical file, two views — see
    // lib/red-artists/project-link.ts). Removing that reference must happen
    // BEFORE the bytes go, so no library can ever point at a deleted file.
    // Strictly path-based, so only the version(s) for THIS exact file are
    // dropped; survivors keep their numbers and the previous version becomes
    // current again.
    //
    // The target artist is resolved FROM THE PROJECT (its primary artist), so a
    // delete can only ever touch that project's own artist — never the other
    // one's library. A no-op for every project outside the two link-enabled
    // artists. If it FAILS we abort the whole delete — destroying bytes a
    // manifest still references is the one outcome we refuse.
    try {
      const { unlinkProjectPathFromArtist } = await import("@/lib/red-artists/project-link");
      const { removed, sketchIds, artistName } = await unlinkProjectPathFromArtist(projectId, dropboxPath);
      if (removed > 0) {
        console.log(`[dropbox/delete] unlinked ${removed} sketch version(s) for ${artistName} [${sketchIds.join(", ")}] at ${dropboxPath}`);
      }
    } catch (e) {
      console.error("[dropbox/delete] artist un-link failed — aborting delete:", e instanceof Error ? e.message : e);
      return NextResponse.json(
        { error: "לא ניתן לעדכן את ספריית האמן — המחיקה בוטלה, נסה שוב" },
        { status: 500 }
      );
    }

    // ── 1. Delete from Dropbox ────────────────────────────────────────────────
    const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: dropboxPath }),
    });

    if (!delRes.ok) {
      const errText = await delRes.text();
      console.error("[dropbox/delete] Dropbox error:", errText);
      return NextResponse.json(
        { error: "שגיאה במחיקה מ-Dropbox" },
        { status: 500 }
      );
    }

    // ── 2. Remove from Supabase ───────────────────────────────────────────────
    const { removeFileFromProjectByPath } = await import("@/lib/projects-store");
    await removeFileFromProjectByPath(projectId, dropboxPath);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/delete]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
