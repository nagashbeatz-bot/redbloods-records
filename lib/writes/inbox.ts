/**
 * THE FILE CHANNEL — "Sunny Inbox". A file the Boss hands Sunny arrives in ONE fixed staging folder of the connected
 * storage (the Boss drops it there from the storage app / share sheet). Sunny only ever sees a HANDLE per item
 * (`inboxItem` = sha256 of the stored path, 24 hex) plus its name / size / type — never a path or a link — and places
 * it, after the Boss approves the exact preview, through the SAME canonical Redbloods writer the screen upload uses
 * (same limits, types, naming, duplicate rule, metadata). A placed item leaves the inbox; a failed placement leaves it.
 * No generic filesystem access: this module reads / moves / deletes ONLY inside INBOX_FOLDER.
 */
import { createHash } from "node:crypto";

export const INBOX_FOLDER = "/Sunny Inbox";
export interface InboxItem { ref: string; name: string; size: number; modifiedAt: string | null; mime: string }
interface InboxEntry extends InboxItem { path: string }

const refOf = (pathLower: string) => createHash("sha256").update(pathLower).digest("hex").slice(0, 24);
const MIME: Record<string, string> = {
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aif: "audio/aiff", aiff: "audio/aiff", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", avif: "image/avif",
  pdf: "application/pdf", txt: "text/plain", rtf: "application/rtf", csv: "text/csv", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm",
};
/** The type a browser would report for this file name (the same extension → MIME mapping the screens rely on). */
export const mimeOfName = (name: string) => MIME[(name.split(".").pop() ?? "").toLowerCase()] ?? "";

function arg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
async function token(): Promise<string> { const { getDropboxToken } = await import("@/lib/dropbox-token"); return getDropboxToken(); }
async function api(t: string, endpoint: string, body: unknown) {
  return fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function entries(): Promise<InboxEntry[]> {
  const t = await token();
  const created = await api(t, "files/create_folder_v2", { path: INBOX_FOLDER, autorename: false });
  if (!created.ok) { const txt = await created.text(); if (!/conflict/i.test(txt)) throw new Error("inbox unavailable"); }
  const out: InboxEntry[] = [];
  let res = await api(t, "files/list_folder", { path: INBOX_FOLDER, recursive: false });
  for (let guard = 0; guard < 20; guard++) {
    if (!res.ok) throw new Error("inbox unavailable");
    const d = (await res.json()) as { entries?: Array<{ ".tag": string; name: string; path_lower: string; path_display: string; size?: number; server_modified?: string }>; has_more?: boolean; cursor?: string };
    for (const e of d.entries ?? []) if (e[".tag"] === "file") out.push({ ref: refOf(e.path_lower), name: e.name, size: e.size ?? 0, modifiedAt: e.server_modified ?? null, mime: mimeOfName(e.name), path: e.path_display });
    if (!d.has_more || !d.cursor) break;
    res = await api(t, "files/list_folder/continue", { cursor: d.cursor });
  }
  return out.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

/** Metadata only (the path never leaves this module). */
export async function listInbox(): Promise<InboxItem[]> { return (await entries()).map(({ path: _p, ...x }) => { void _p; return x; }); }
async function entry(ref: string): Promise<InboxEntry | null> { return /^[0-9a-f]{24}$/.test(ref) ? (await entries()).find((e) => e.ref === ref) ?? null : null; }
export async function inboxItem(ref: string): Promise<InboxItem | null> { const e = await entry(ref); if (!e) return null; const { path: _p, ...x } = e; void _p; return x; }

/** The item as a File — for writers that take the screen's File (same validation / naming as a browser upload). */
export async function inboxAsFile(ref: string): Promise<File> {
  const e = await entry(ref); if (!e) throw new Error("inbox item not found");
  const t = await token();
  const res = await fetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Dropbox-API-Arg": arg({ path: e.path }) } });
  if (!res.ok) throw new Error("inbox read failed");
  return new File([Buffer.from(await res.arrayBuffer())], e.name, { type: e.mime });
}
/** Move the item into a destination the canonical writer computed (big files never pass through memory). */
export async function moveInboxItem(ref: string, toPath: string, autorename: boolean): Promise<{ ok: true; path: string; size: number } | { ok: false; conflict: boolean; error: string }> {
  const e = await entry(ref); if (!e) return { ok: false, conflict: false, error: "inbox item not found" };
  const t = await token();
  const res = await api(t, "files/move_v2", { from_path: e.path, to_path: toPath, autorename, allow_ownership_transfer: false });
  if (!res.ok) { const txt = await res.text(); return { ok: false, conflict: /conflict/i.test(txt), error: `storage: ${txt.slice(0, 200)}` }; }
  const d = (await res.json()) as { metadata: { path_display: string; size?: number } };
  return { ok: true, path: d.metadata.path_display, size: d.metadata.size ?? e.size };
}
/** A placed (or discarded) item leaves the inbox. */
export async function removeInboxItem(ref: string): Promise<void> {
  const e = await entry(ref); if (!e) return;
  const t = await token();
  const res = await api(t, "files/delete_v2", { path: e.path });
  if (!res.ok && !/not_found/.test(await res.text())) throw new Error("inbox cleanup failed");
}
