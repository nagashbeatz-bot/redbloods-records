import { NextRequest, NextResponse } from "next/server";

async function createDropboxShareLink(token: string, path: string): Promise<string> {
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

  const err = (await res.json()) as Record<string, unknown>;
  const errObj = err.error as Record<string, unknown> | undefined;
  if (errObj?.[".tag"] === "shared_link_already_exists") {
    const inner = errObj.shared_link_already_exists as Record<string, unknown> | undefined;
    const url = (inner?.metadata as Record<string, string> | undefined)?.url;
    if (url) return url;
  }
  throw new Error((err.error_summary as string) ?? "Failed to create Dropbox share link");
}

// POST /api/dropbox/share-link
// Body: { dropboxPath: string, projectId: string }
export async function POST(req: NextRequest) {
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const { dropboxPath, projectId } = await req.json();
    if (!dropboxPath || !projectId) return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });

    const shareUrl = await createDropboxShareLink(token, dropboxPath);

    const { updateFileShareUrl } = await import("@/lib/projects-store");
    await updateFileShareUrl(projectId, dropboxPath, shareUrl);

    return NextResponse.json({ ok: true, shareUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/share-link]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
