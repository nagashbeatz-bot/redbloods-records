"use client";

/**
 * Save-or-share a same-origin audio attachment.
 *
 * Lifted verbatim out of MiniPlayer's DownloadControl so the global player and the
 * sketch "ביט" download run the SAME code path — one implementation, so the two can
 * never drift apart again. The player's behaviour is unchanged by the move.
 *
 * On a touch-primary device that supports the File Share API this opens the native
 * Share Sheet with a real File (iOS → "שמירה בקבצים" / WhatsApp / AirDrop — no Quick
 * Look, no navigation away from the app). Everywhere else — desktop, or Android
 * without the API — it falls back to a normal Blob download. It never uses
 * window.open, never opens a tab and never navigates the app.
 */

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
  flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff", aac: "audio/aac",
};

/** Best-effort MIME from the filename — the Share Sheet needs a typed File. */
export function guessMime(name: string): string {
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Extract a clean filename from a Content-Disposition header (RFC 5987 first, so
 *  Hebrew names survive the round trip). */
export function parseFilename(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { return star[1].trim(); } }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : null;
}

/** Touch-primary device (phone/tablet) — feature detection, not UA sniffing. */
export function isTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  try { return !!window.matchMedia?.("(pointer: coarse)")?.matches; } catch { return false; }
}

/**
 * Whether this device can plausibly open the Share Sheet with a file. This is for
 * choosing the ICON/LABEL only — the real decision is made at click time inside
 * `fetchAndSaveOrShare`, via navigator.canShare({ files }) with the actual file.
 */
export function canShareFiles(): boolean {
  return isTouchPrimary() && typeof navigator !== "undefined"
    && typeof navigator.share === "function" && typeof navigator.canShare === "function";
}

/** Plain Blob download through a temporary object URL. */
export function blobDownload(blob: Blob, name: string) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

/**
 * Fetch a same-origin attachment and hand it to the Share Sheet, or download it.
 *
 * The filename prefers the server's Content-Disposition and falls back to
 * `fallbackName`. Callers pass the name they already know (the track's, or the
 * sketch's stored beat file name), so a route that sends no header still yields the
 * right name rather than a UUID — the name never comes from the URL.
 *
 * A dismissed Share Sheet (AbortError) resolves normally: the user cancelling is not
 * a failure and must never surface as an error. Throws on a non-ok response or a
 * genuine share failure, and leaves it to the caller to decide how to show that.
 */
export async function fetchAndSaveOrShare(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const blob = await res.blob();
  const name = parseFilename(res.headers.get("Content-Disposition")) || fallbackName;

  // Touch + File Share API → native Share Sheet with a real file (no Quick Look).
  if (canShareFiles()) {
    const file = new File([blob], name, { type: blob.type || guessMime(name) });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return; // user shared / saved, or is handling it
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return; // cancelled the sheet → NOT an error
        throw e;
      }
    }
  }
  // Desktop / Android / no File Share → normal download.
  blobDownload(blob, name);
}
