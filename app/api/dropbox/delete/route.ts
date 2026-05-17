import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const token = process.env.DROPBOX_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "DROPBOX_ACCESS_TOKEN לא מוגדר בסביבה" },
        { status: 500 }
      );
    }

    const { dropboxPath, projectId } = await req.json();

    if (!dropboxPath || typeof dropboxPath !== "string") {
      return NextResponse.json({ error: "dropboxPath נדרש" }, { status: 400 });
    }
    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId נדרש" }, { status: 400 });
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
