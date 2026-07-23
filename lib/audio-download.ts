import "server-only";
import { dropboxArg } from "@/lib/mix-version-upload";

/**
 * Same-origin audio DOWNLOAD helper. Unlike the *stream* endpoints (which 302 to a
 * Dropbox temporary link — cross-origin, so iOS ignores the <a download> hint and
 * shows Quick Look), this pulls the file bytes SERVER-SIDE and returns them as a
 * proper attachment with a clean filename. No 302, no temp link, no dropbox_path /
 * token ever reaches the client. Auth is the CALLER's responsibility.
 */

const MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
  flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff", aac: "audio/aac",
};

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

/** A clean, path-safe download filename (base + extension). Never a token/UUID. */
export function safeDownloadName(base: string, ext: string): string {
  let n = (base || "audio").replace(/[/\\:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim() || "audio";
  if (ext && !new RegExp(`\\.${ext}$`, "i").test(n)) n = `${n}.${ext}`;
  return n;
}

/** Fetch a Dropbox file and return it as a same-origin attachment Response. */
export async function dropboxAttachment(dropboxPath: string, filename: string): Promise<Response> {
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();

  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": dropboxArg({ path: dropboxPath }) },
  });
  if (!res.ok) {
    console.error("[audio-download]", res.status, await res.text().catch(() => ""));
    return new Response(JSON.stringify({ error: "שגיאה בהורדת הקובץ" }), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  const buf = await res.arrayBuffer();
  const mime = MIME[extOf(filename)] ?? "application/octet-stream";
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      // RFC 5987 — safe for Hebrew/UTF-8 names. attachment → download, not inline preview.
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
