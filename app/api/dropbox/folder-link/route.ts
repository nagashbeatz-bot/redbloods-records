import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * POST /api/dropbox/folder-link
 * Returns a REAL Dropbox shared link for an existing folder path, creating it
 * if needed, and reports its effective visibility so the caller can tell an
 * external (public) client link from an internal one.
 *
 * Body: { path }  (app-folder-relative, e.g. "/Projects/Artist/Song/Delivery")
 * Returns: { ok, shareLink, visibility }   visibility e.g. "public" | "team_only" | "shared_folder_only"
 *
 * Notes:
 *  - A logged-in owner opening a scl/fo link is redirected by Dropbox to the
 *    /home file browser — that is normal, not a bug.
 *  - For an EXTERNAL client link the resolved visibility must be "public"
 *    (opens anonymously, no login). If the account/team policy forbids public
 *    links, Dropbox keeps it restricted and we surface that visibility instead
 *    of pretending the link is shareable.
 */

const PUBLIC_SETTINGS = { requested_visibility: { ".tag": "public" } };

type LinkMeta = { url?: string; link_permissions?: { resolved_visibility?: { ".tag"?: string } } };

function visibilityOf(meta: LinkMeta | undefined): string | undefined {
  return meta?.link_permissions?.resolved_visibility?.[".tag"];
}

async function dropbox(token: string, endpoint: string, body: unknown): Promise<Response> {
  return fetch(`https://api.dropboxapi.com/2/sharing/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Create the link if missing, otherwise reuse the existing one (the
// already-exists error does NOT always carry the url, so fall back to
// list_shared_links). When reusing an existing link, best-effort upgrade it to
// public — older links may predate the public setting.
async function getOrCreateFolderShareLink(
  token: string,
  path: string,
): Promise<{ url: string; visibility?: string }> {
  const res = await dropbox(token, "create_shared_link_with_settings", { path, settings: PUBLIC_SETTINGS });
  if (res.ok) {
    const data = (await res.json()) as LinkMeta;
    return { url: data.url!, visibility: visibilityOf(data) };
  }

  const body = (await res.json()) as {
    error_summary?: string;
    error?: { shared_link_already_exists?: { metadata?: LinkMeta } };
  };

  let meta: LinkMeta | undefined = body?.error?.shared_link_already_exists?.metadata;
  if (!meta?.url) {
    const listRes = await dropbox(token, "list_shared_links", { path, direct_only: true });
    if (listRes.ok) {
      const listData = (await listRes.json()) as { links?: LinkMeta[] };
      if (listData.links?.length) meta = listData.links[0];
    }
  }

  if (meta?.url) {
    // Best-effort: make sure the existing link is public (no-op if already, and
    // simply ignored if the account policy refuses public links).
    if (visibilityOf(meta) !== "public") {
      try {
        const modRes = await dropbox(token, "modify_shared_link_settings", { url: meta.url, settings: PUBLIC_SETTINGS });
        if (modRes.ok) meta = (await modRes.json()) as LinkMeta;
      } catch { /* keep existing link + visibility */ }
    }
    return { url: meta.url!, visibility: visibilityOf(meta) };
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

    const { url, visibility } = await getOrCreateFolderShareLink(token, path);
    return NextResponse.json({ ok: true, shareLink: url, visibility });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    console.error("[dropbox/folder-link]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
