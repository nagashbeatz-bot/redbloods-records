import { NextRequest, NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";
import { queueVictorUploadNotice } from "@/lib/victor-upload-notify";

// Chunked Victor upload (large files up to 1GB) via the Dropbox upload-session
// API. Each request carries ONE small chunk (~8MB), never the whole file — so
// memory stays tiny and the proxy body limit is never approached (NOT raised).
// Parallel to the Steven work-materials chunk route; mirrors the single-shot
// /api/dropbox/vendor-upload path (folder resolved server-side, same naming,
// appended to vendor_project_work.files_sent). No public share link is created.
export const maxDuration = 300;

/** Escape non-ASCII for the Dropbox-API-Arg header (headers must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/**
 * POST /api/dropbox/vendor-upload/chunk?action=start|append|finish
 *   start  → upload_session/start          (first chunk)          → { sessionId }
 *   append → upload_session/append_v2       (middle chunks)        → { ok }
 *   finish → upload_session/finish + commit (last chunk)           → { file }
 *
 * Query on finish: workId, sessionId, offset, name (desired filename, already
 * version-prefixed by the client), subFolder ("Production"), versionLabel?.
 * Owner + Victor (requireVictorAccess), same as the single-shot route. The
 * Dropbox path is derived SERVER-SIDE from the workId (ensureVendorFolder) —
 * the client never sends a path, so there's no traversal surface and Victor
 * never receives the Artist/Project-revealing folder.
 */
export async function POST(req: NextRequest) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const sp     = req.nextUrl.searchParams;
    const action = sp.get("action");
    const buffer = Buffer.from(await req.arrayBuffer()); // one chunk only

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    // ── start: open a session with the first chunk ──
    if (action === "start") {
      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ close: false }) },
        body: buffer,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Dropbox: ${await res.text()}` }, { status: 500 });
      const d = (await res.json()) as { session_id: string };
      return NextResponse.json({ ok: true, sessionId: d.session_id });
    }

    // ── append: add a chunk at the given byte offset ──
    if (action === "append") {
      const sessionId = sp.get("sessionId") ?? "";
      const offset    = Number(sp.get("offset") ?? "0");
      if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId חסר" }, { status: 400 });
      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/append_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ cursor: { session_id: sessionId, offset }, close: false }) },
        body: buffer,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Dropbox: ${await res.text()}` }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── finish: commit the last chunk to the work's Production folder ──
    if (action === "finish") {
      const workId       = sp.get("workId") ?? "";
      const sessionId    = sp.get("sessionId") ?? "";
      const offset       = Number(sp.get("offset") ?? "0");
      const rawName      = sp.get("name") ?? "";
      const versionLabel = sp.get("versionLabel") || undefined;
      if (!workId)    return NextResponse.json({ ok: false, error: "workId חסר" }, { status: 400 });
      if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId חסר" }, { status: 400 });
      if (!rawName)   return NextResponse.json({ ok: false, error: "name חסר" }, { status: 400 });

      // Resolve the base folder SERVER-SIDE from the workId (creating it on first
      // use). Throws for a non-Victor / missing work — the ownership gate.
      let baseFolder: string;
      try {
        const { ensureVendorFolder } = await import("@/lib/vendor-folder");
        baseFolder = await ensureVendorFolder(workId);
      } catch (e) {
        console.error("[vendor-upload/chunk] folder resolve failed:", e);
        return NextResponse.json({ ok: false, error: "folder not ready" }, { status: 409 });
      }

      // Same path construction as the single-shot route: sanitize the (already
      // version-prefixed) filename; subFolder is a fixed bucket — strip anything
      // that isn't a plain name so it can't alter the path (no traversal).
      const sanitizedName  = rawName.replace(/[<>:"/\\|?*]/g, "_");
      const cleanSubFolder = (sp.get("subFolder") ?? "Production").replace(/[^A-Za-z0-9_]/g, "");
      const cleanBase      = baseFolder.replace(/\/+$/, "");
      const dropboxPath    = cleanSubFolder
        ? `${cleanBase}/${cleanSubFolder}/${sanitizedName}`
        : `${cleanBase}/${sanitizedName}`;

      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/finish", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ cursor: { session_id: sessionId, offset }, commit: { path: dropboxPath, mode: "add", autorename: true, mute: false } }) },
        body: buffer,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Dropbox: ${await res.text()}` }, { status: 500 });
      const uploaded  = (await res.json()) as { path_display: string; name: string; size?: number };
      const finalPath = uploaded.path_display;
      const streamUrl = `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`;

      // Persist to vendor_project_work.files_sent — SAME shape as the single-shot
      // route, minus the public share link (none is created here). dropboxPath +
      // stream url are enough for playback/download via the scoped Victor route.
      const newFile = { name: uploaded.name, url: streamUrl, dropboxPath: finalPath, dropboxShareUrl: "", uploadedAt: new Date().toISOString(), ...(versionLabel ? { versionLabel } : {}) };

      const { updateVictorWork } = await import("@/lib/vendor-store");
      const { supabase } = await import("@/lib/supabase");
      const { data: row } = await supabase
        .from("vendor_project_work")
        .select("files_sent, project_id, vendor_name, title")
        .eq("id", workId)
        .maybeSingle();

      // Ownership: only Victor's work rows may receive uploads here.
      if (!row || (row.vendor_name as string) !== "victor") {
        // Roll back the committed file so a rejected upload leaves nothing behind.
        try {
          await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ path: finalPath }),
          });
        } catch { /* best-effort */ }
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }

      const currentFiles = (row.files_sent as typeof newFile[]) ?? [];
      try {
        await updateVictorWork(workId, { filesSent: [...currentFiles, newFile] });
      } catch (dbErr) {
        try {
          await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ path: finalPath }),
          });
        } catch { /* best-effort */ }
        throw dbErr;
      }

      // ── Owner push (batched) — parity with the single-shot route: only when
      //    Victor uploaded, only after the file is saved, best-effort. ──
      try {
        if ((await getAuthRole()) === "victor") {
          let projectName = (row.title as string | null) ?? "";
          if (!projectName && row.project_id) {
            const { data: proj } = await supabase
              .from("projects").select("name").eq("id", row.project_id as string).maybeSingle();
            projectName = (proj?.name as string) ?? "";
          }
          await queueVictorUploadNotice(workId, projectName || "פרויקט");
        }
      } catch (e) {
        console.error("[vendor-upload/chunk] notify queue failed (non-fatal):", e);
      }

      return NextResponse.json({ ok: true, file: newFile });
    }

    return NextResponse.json({ ok: false, error: "action לא תקין" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/vendor-upload/chunk]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
