import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * POST /api/dropbox/folder-link
 * Returns a REAL Dropbox shared link for an existing folder path, creating it
 * if needed. Used by "open folder" buttons so we never hand the user a manually
 * built /home/... URL (which omits the app-folder prefix and lands on an
 * "unknown folder"). The Dropbox API resolves the app-relative path correctly.
 *
 * Body: { path }  (app-folder-relative, e.g. "/Projects/Artist/Song/Delivery")
 * Returns: { ok, shareLink }
 */
// Mirrors the proven getOrCreateShareLink in /api/dropbox/vendor-folder, which
// already returns working folder links for Victor: create → if it already
// exists, take the inline metadata url → otherwise fall back to
// list_shared_links (the already-exists error does NOT always carry the url).
async function getOrCreateFolderShareLink(token: string, path: string): Promise<string> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, settings: { requested_visibility: { ".tag": "public" } } }),
    }
  );

  if (res.ok) {
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  // Link already exists → Dropbox sometimes returns it inline in the error.
  const body = (await res.json()) as {
    error_summary?: string;
    error?: { shared_link_already_exists?: { metadata?: { url?: string } } };
  };
  const existing = body?.error?.shared_link_already_exists?.metadata?.url;
  if (existing) return existing;

  // Fallback: the link exists but the url wasn't inline — fetch it directly.
  const listRes = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, direct_only: true }),
  });
  if (listRes.ok) {
    const listData = (await listRes.json()) as { links?: { url: string }[] };
    if (listData.links?.length) return listData.links[0].url;
  }

  // Safe diagnostics (no token): which path failed and Dropbox's own summary.
  console.error(`[dropbox/folder-link] create failed: status=${res.status} path=${path} summary=${body.error_summary ?? "?"}`);
  throw new Error(body.error_summary ?? "Failed to create Dropbox folder share link");
}

export async function POST(req: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const { path } = (await req.json()) as { path?: string };
    if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });

    const shareLink = await getOrCreateFolderShareLink(token, path);
    return NextResponse.json({ ok: true, shareLink });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    console.error("[dropbox/folder-link]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
