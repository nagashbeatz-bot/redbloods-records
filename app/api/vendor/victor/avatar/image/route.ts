import { NextResponse } from "next/server";
import { requireVictorAccess } from "@/lib/require-auth";
import { getVictorAvatar } from "@/lib/victor-avatar";

/**
 * GET /api/vendor/victor/avatar/image  → 302 to a short-lived Dropbox temp link
 * for the source avatar. Owner OR Victor only. Used as the <img>/background src
 * (same-origin, so the session cookie rides along). No token reaches the client.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireVictorAccess(); if (denied) return denied;
  const a = await getVictorAvatar();
  if (!a.dropboxPath) return NextResponse.json({ error: "no avatar" }, { status: 404 });
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: a.dropboxPath }),
    });
    if (!res.ok) { console.error("[victor/avatar/image]", await res.text()); return NextResponse.json({ error: "link failed" }, { status: 502 }); }
    const data = (await res.json()) as { link: string };
    return NextResponse.redirect(data.link, 302);
  } catch (e) {
    console.error("[victor/avatar/image]", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
