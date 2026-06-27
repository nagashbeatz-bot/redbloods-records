import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const { dropboxPath } = await req.json() as { dropboxPath?: string };

    if (!dropboxPath || typeof dropboxPath !== "string") {
      return NextResponse.json({ error: "dropboxPath נדרש" }, { status: 400 });
    }

    const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: dropboxPath }),
    });

    if (!delRes.ok) {
      const errText = await delRes.text();
      let summary = errText;
      try { summary = JSON.parse(errText)?.error_summary ?? errText; } catch { /* keep raw */ }
      // Already gone in Dropbox (deleted manually / bad path) → treat as success
      // so the file can still be removed from the work's list (hard delete).
      if (summary.includes("not_found")) {
        return NextResponse.json({ ok: true, notFound: true });
      }
      console.error("[dropbox/vendor-delete]", summary);
      return NextResponse.json({ error: "שגיאה במחיקה מ-Dropbox" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/vendor-delete]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
