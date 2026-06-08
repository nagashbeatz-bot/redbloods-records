/**
 * Shared helpers for Dropbox folder operations.
 * Used by Red Films and any future production-level folder creation.
 */

export async function createDropboxFolder(token: string, path: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error_summary?: string };
    if (typeof body.error_summary === "string" && body.error_summary.includes("conflict")) return;
    throw new Error(`יצירת תיקייה נכשלה: ${path}`);
  }
}

export async function getOrCreateFolderShareLink(token: string, path: string): Promise<string> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, settings: { requested_visibility: "public" } }),
    }
  );
  if (res.ok) {
    const data = (await res.json()) as { url: string };
    return data.url;
  }
  const body = (await res.json()) as {
    error?: { shared_link_already_exists?: { metadata?: { url?: string } } };
  };
  const existing = body?.error?.shared_link_already_exists?.metadata?.url;
  if (existing) return existing;

  // Fallback: list existing links
  const listRes = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, direct_only: true }),
  });
  if (listRes.ok) {
    const listData = (await listRes.json()) as { links?: { url: string }[] };
    if (listData.links?.length) return listData.links[0].url;
  }
  throw new Error("לא ניתן ליצור share link לתיקייה");
}
