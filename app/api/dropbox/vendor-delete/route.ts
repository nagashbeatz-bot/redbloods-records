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
      console.error("[dropbox/vendor-delete]", errText);
      return NextResponse.json({ error: "שגיאה במחיקה מ-Dropbox" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/vendor-delete]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
