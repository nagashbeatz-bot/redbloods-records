import { NextResponse } from "next/server";
import { getDropboxToken } from "@/lib/dropbox-token";
import { requireVictorAccess } from "@/lib/require-auth";

/**
 * POST /api/dropbox/vendor-folder
 * Creates a vendor folder structure in Dropbox and returns a share link.
 *
 * Body: { vendorName, artistName, projectName }
 * Returns: { ok, folderPath, shareLink }
 *
 * Folder structure created:
 *   /{vendorName}/{artistName} - {projectName}/
 *   /{vendorName}/{artistName} - {projectName}/01_From_Redbloods/
 *   /{vendorName}/{artistName} - {projectName}/02_From_{VendorName}/
 *   /{vendorName}/{artistName} - {projectName}/03_Approved/
 */

function sanitizeName(s: string): string {
  return s
    .replace(/[<>:"/\\|?*]/g, "") // remove forbidden chars
    .replace(/\s+/g, " ")
    .trim();
}

async function createFolder(token: string, path: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, autorename: false }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error_summary?: string };
    // Ignore "folder already exists" errors
    if (typeof body.error_summary === "string" && body.error_summary.startsWith("path/conflict/folder")) return;
    // Ignore "path/conflict" (already exists)
    if (typeof body.error_summary === "string" && body.error_summary.includes("conflict")) return;
    throw new Error(`׳™׳¦׳™׳¨׳× ׳×׳™׳§׳™׳™׳” ׳ ׳›׳©׳׳”: ${JSON.stringify(body)}`);
  }
}

async function getOrCreateShareLink(token: string, path: string): Promise<string> {
  const res = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path,
      settings: { requested_visibility: { ".tag": "public" } },
    }),
  });

  if (res.ok) {
    const data = await res.json() as { url: string };
    return data.url.replace("?dl=0", "?dl=0"); // keep as-is
  }

  // If link already exists, fetch it
  const body = await res.json() as { error?: { shared_link_already_exists?: { metadata?: { url?: string } } }; url?: string };
  const existing = body?.error?.shared_link_already_exists?.metadata?.url;
  if (existing) return existing;

  // Fallback: list existing links
  const listRes = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, direct_only: true }),
  });
  if (listRes.ok) {
    const listData = await listRes.json() as { links?: { url: string }[] };
    if (listData.links?.length) return listData.links[0].url;
  }

  throw new Error("׳׳ ׳ ׳™׳×׳ ׳׳™׳¦׳•׳¨ ׳׳• ׳׳§׳‘׳ ׳׳™׳ ׳§ ׳©׳™׳×׳•׳£ ׳׳×׳™׳§׳™׳™׳× ׳”׳¡׳₪׳§");
}

export async function POST(req: Request) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const body = await req.json() as {
      vendorName:  string;
      artistName:  string;
      projectName: string;
    };

    const { vendorName, artistName, projectName } = body;
    // Scope to Victor's vendor tree only (single supplier in Phase 2A).
    if ((vendorName ?? "").trim().toLowerCase() !== "victor") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    if (!vendorName || !artistName || !projectName) {
      return NextResponse.json({ ok: false, error: "׳—׳¡׳¨׳™׳ ׳©׳“׳•׳×: vendorName, artistName, projectName" }, { status: 400 });
    }

    const token    = await getDropboxToken();
    const vendor   = sanitizeName(vendorName);
    const folder   = `${sanitizeName(artistName)} - ${sanitizeName(projectName)}`;
    const basePath = `/${vendor}/${folder}`;

    // Capitalize vendor name for "02_From_Victor"
    const fromThem = `02_From_${vendor.charAt(0).toUpperCase() + vendor.slice(1)}`;

    await createFolder(token, basePath);
    await createFolder(token, `${basePath}/01_From_Redbloods`);
    await createFolder(token, `${basePath}/${fromThem}`);
    await createFolder(token, `${basePath}/03_Approved`);
    await createFolder(token, `${basePath}/Production`);

    const shareLink = await getOrCreateShareLink(token, basePath);

    return NextResponse.json({ ok: true, folderPath: basePath, shareLink });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "׳©׳’׳™׳׳× ׳©׳¨׳×";
    console.error("[dropbox/vendor-folder]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
