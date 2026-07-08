import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * GET /api/red-artists/performance-files
 *
 * OWNER ONLY. Lists the audio files under the server-owned performance folder
 * (recursive → covers playbacks / clean-versions / dj-versions / show-intros /
 * sets). Returns a play URL via the existing /api/dropbox/stream. No DB, no
 * metadata. A not-yet-created folder is treated as empty (not an error).
 */
const PERF = "/app/red-artists/shalev-tasama/performance-files";
const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aif", "aiff"]);

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

type Entry = { ".tag"?: string; name: string; path_display?: string; path_lower?: string };

export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const entries: Entry[] = [];

    let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST", headers,
      body: JSON.stringify({ path: PERF, recursive: true, limit: 2000 }),
    });

    if (!res.ok) {
      const t = await res.text();
      // Folder not created yet → empty list, not an error.
      if (res.status === 409 || t.includes("path/not_found")) {
        return NextResponse.json({ ok: true, files: [] });
      }
      console.error("[red-artists/performance-files]", t);
      return NextResponse.json({ ok: false, error: "שגיאה בטעינת הקבצים" }, { status: 500 });
    }

    let data = (await res.json()) as { entries?: Entry[]; has_more?: boolean; cursor?: string };
    entries.push(...(data.entries ?? []));
    while (data.has_more && data.cursor) {
      res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
        method: "POST", headers, body: JSON.stringify({ cursor: data.cursor }),
      });
      if (!res.ok) break;
      data = (await res.json()) as { entries?: Entry[]; has_more?: boolean; cursor?: string };
      entries.push(...(data.entries ?? []));
    }

    const files = entries
      .filter((e) => e[".tag"] === "file" && AUDIO_EXT.has(extOf(e.name)))
      .map((e) => {
        const p = e.path_display ?? e.path_lower ?? `${PERF}/${e.name}`;
        return { name: e.name, path: p, url: `/api/dropbox/stream?path=${encodeURIComponent(p)}` };
      });

    return NextResponse.json({ ok: true, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[red-artists/performance-files]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
