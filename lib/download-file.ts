"use client";

/**
 * The ONE "Download" action for Redbloods OS. Every button whose meaning is "save
 * this file to my computer" goes through `saveFileAs` — never window.open, never
 * target=_blank, never a navigation to a stream URL.
 *
 * `url` is always an EXISTING, role-scoped, same-origin route (the caller keeps using
 * whatever its role already gets: /api/dropbox/stream, /api/supplier/steven/stream,
 * /api/vendor/victor/*, the artist /download routes …). Permissions are those routes'
 * job and are untouched; this file only decides how the browser saves the response.
 * It holds no secrets and no Dropbox token — it just fetches with the session cookie.
 *
 *  1. Chrome / Edge desktop — showSaveFilePicker, called FIRST and synchronously inside
 *     the caller's click (no await before it, or the user activation is lost) with the
 *     real filename as suggestedName. Only after a location is chosen is `url` fetched
 *     and piped straight into the file (response.body.pipeTo), so a big WAV/ZIP is never
 *     held in memory. The stream routes 302 to a Dropbox temp link that answers CORS
 *     with `*`; the /download routes return same-origin bytes.
 *  2. Touch device that can share files — the existing fetchAndSaveOrShare (native Share
 *     Sheet: "Save to Files" / WhatsApp / AirDrop), exactly as the global player and the
 *     artist beat chip already behave. The File System API is never forced on mobile.
 *  3. Anything else — a plain same-tab <a download> click. No target=_blank, no tab.
 *
 * Cancel (AbortError, from the picker or the share sheet) is silent. Any real failure
 * calls `onError` once; the caller decides how to show its own translated message.
 */

import { canShareFiles, fetchAndSaveOrShare } from "@/lib/audio-share";

type SaveWritable = WritableStream<Uint8Array>;
type SaveHandle = { createWritable: () => Promise<SaveWritable> };
type SavePicker = (o: {
  suggestedName: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

export async function saveFileAs(url: string, fileName: string, onError: () => void): Promise<void> {
  const name = (fileName || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "download";
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

  if (typeof picker !== "function") {
    if (canShareFiles()) {
      try { await fetchAndSaveOrShare(url, name); } catch { onError(); }
      return;
    }
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }

  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  let handle: SaveHandle;
  try {
    handle = await picker.call(window, {
      suggestedName: name,
      ...(ext ? { types: [{ description: `${ext.toUpperCase()} file`, accept: { "application/octet-stream": [`.${ext.toLowerCase()}`] } }] } : {}),
    });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) onError(); // Cancel = silent
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await res.body.pipeTo(await handle.createWritable());
  } catch {
    onError();
  }
}
