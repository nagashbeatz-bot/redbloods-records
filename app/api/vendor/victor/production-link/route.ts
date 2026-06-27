import { NextResponse } from "next/server";
import { requireVictorAccess } from "@/lib/require-auth";

/**
 * POST /api/vendor/victor/production-link
 * Victor-safe "open in Dropbox" link: given only a workId, derive the work's
 * stored dropbox_folder server-side and return a share link for its Production
 * subfolder (where every Victor upload lands). Victor never passes a free path,
 * so this can't be used to probe other folders. Lives under /api/vendor/victor
 * so it's already covered by isVictorAllowedPath (owner + victor).
 *
 * Body: { workId }
 * Returns: { ok, shareLink, visibility }
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

// Same resilient logic as /api/dropbox/folder-link: create → reuse existing
// (inline or via list_shared_links) → best-effort make it public.
async function getOrCreateFolderShareLink(token: string, path: string): Promise<{ url: string; visibility?: string }> {
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
    if (visibilityOf(meta) !== "public") {
      try {
        const modRes = await dropbox(token, "modify_shared_link_settings", { url: meta.url, settings: PUBLIC_SETTINGS });
        if (modRes.ok) meta = (await modRes.json()) as LinkMeta;
      } catch { /* keep existing link */ }
    }
    return { url: meta.url!, visibility: visibilityOf(meta) };
  }

  console.error(`[vendor/victor/production-link] create failed: status=${res.status} path=${path} summary=${body.error_summary ?? "?"}`);
  throw new Error(body.error_summary ?? "Failed to create Dropbox folder share link");
}

export async function POST(req: Request) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { workId } = (await req.json()) as { workId?: string };
    if (!workId) return NextResponse.json({ error: "workId נדרש" }, { status: 400 });

    // Resolve the folder from the DB record — never trust a client path.
    const { getVictorWorkById } = await import("@/lib/vendor-store");
    const work = await getVictorWorkById(workId);
    if (!work || work.vendorName !== "victor") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!work.dropboxFolder) {
      return NextResponse.json({ error: "אין עדיין תיקיית Dropbox לעבודה" }, { status: 400 });
    }

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const { url, visibility } = await getOrCreateFolderShareLink(token, `${work.dropboxFolder}/Production`);
    return NextResponse.json({ ok: true, shareLink: url, visibility });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    console.error("[vendor/victor/production-link]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
