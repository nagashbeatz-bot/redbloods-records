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
async function createFolderShareLink(token: string, path: string): Promise<string> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, settings: { requested_visibility: "public" } }),
    }
  );

  if (res.ok) {
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  // Link already exists → Dropbox returns it inside the error payload.
  const err = (await res.json()) as Record<string, unknown>;
  const errObj = err.error as Record<string, unknown> | undefined;
  if (errObj?.[".tag"] === "shared_link_already_exists") {
    const inner = errObj.shared_link_already_exists as Record<string, unknown> | undefined;
    const url = (inner?.metadata as Record<string, string> | undefined)?.url;
    if (url) return url;
  }
  // Safe diagnostics (no token): which path failed and Dropbox's own summary.
  console.error(`[dropbox/folder-link] create failed: status=${res.status} path=${path} summary=${err.error_summary ?? "?"}`);
  throw new Error((err.error_summary as string) ?? "Failed to create Dropbox folder share link");
}

export async function POST(req: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const { path } = (await req.json()) as { path?: string };
    if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });

    const shareLink = await createFolderShareLink(token, path);
    return NextResponse.json({ ok: true, shareLink });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    console.error("[dropbox/folder-link]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
