import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * POST /api/red-artists/press-kit-link
 *
 * OWNER ONLY. Returns a Dropbox shared link for the server-owned press-kit
 * folder so "פתח תיקייה" can open it. The folder is created first (idempotent) —
 * sharing a non-existent folder fails. No client path, no DB.
 */
const PRESS_KIT = "/app/red-artists/shalev-tasama/press-kit";
const PUBLIC = { requested_visibility: { ".tag": "public" } };

type LinkMeta = { url?: string };

async function sharing(token: string, endpoint: string, body: unknown): Promise<Response> {
  return fetch(`https://api.dropboxapi.com/2/sharing/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    // Ensure the folder exists (idempotent — ignore "already exists" conflict).
    const mk = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: PRESS_KIT, autorename: false }),
    });
    if (!mk.ok) {
      const t = await mk.text();
      if (!t.includes("conflict")) console.error("[red-artists/press-kit-link] create_folder:", t);
    }

    // Create the link, or reuse an existing one.
    const res = await sharing(token, "create_shared_link_with_settings", { path: PRESS_KIT, settings: PUBLIC });
    if (res.ok) {
      const d = (await res.json()) as LinkMeta;
      if (d.url) return NextResponse.json({ ok: true, shareLink: d.url });
    } else {
      const body = (await res.json()) as { error_summary?: string; error?: { shared_link_already_exists?: { metadata?: LinkMeta } } };
      let url = body?.error?.shared_link_already_exists?.metadata?.url;
      if (!url) {
        const list = await sharing(token, "list_shared_links", { path: PRESS_KIT, direct_only: true });
        if (list.ok) {
          const ld = (await list.json()) as { links?: LinkMeta[] };
          url = ld.links?.[0]?.url;
        }
      }
      if (url) return NextResponse.json({ ok: true, shareLink: url });
      console.error("[red-artists/press-kit-link]", body.error_summary ?? "no url");
    }

    return NextResponse.json({ ok: false, error: "לא ניתן לפתוח את התיקייה כרגע" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/press-kit-link]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
