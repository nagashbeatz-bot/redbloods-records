import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { resolveVersionTarget, finalizeMixVersion, dropboxArg } from "@/lib/mix-version-upload";

// Each request carries ONE small chunk (~8MB), never the whole file — so memory
// stays tiny and the proxy body limit is never approached. Large final files
// (masters / stems, up to 1GB) use the Dropbox upload-session API
// (start → append_v2 → finish). Owner variant of the Steven versions/chunk route:
// same naming/commit/mix_versions logic, requireOwner, full (un-sanitized) response.
export const maxDuration = 300;

/** POST /api/sound-engineer/[id]/versions/chunk?action=start|append|finish */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
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

    // ── finish: name the file (shared resolver) + commit + insert mix_versions ──
    if (action === "finish") {
      const sessionId     = sp.get("sessionId") ?? "";
      const offset        = Number(sp.get("offset") ?? "0");
      const fileName      = (sp.get("fileName") ?? "").trim();
      const label         = (sp.get("label") ?? "").trim();
      const addToExisting = sp.get("addToExisting") != null;
      const roleParam     = sp.get("role");
      const durationRaw    = sp.get("durationSeconds");
      const durationParsed = durationRaw != null ? Number(durationRaw) : NaN;
      const durationSeconds = Number.isFinite(durationParsed) && durationParsed > 0 ? Math.round(durationParsed) : null;
      if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId חסר" }, { status: 400 });
      if (!fileName)  return NextResponse.json({ ok: false, error: "חסר שם קובץ" }, { status: 400 });

      const resolved = await resolveVersionTarget(workId, { fileName, label, addToExisting, roleParam, folderKind: "final" });
      if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
      const { target } = resolved;

      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/finish", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ cursor: { session_id: sessionId, offset }, commit: { path: target.dropboxPath, mode: "add", autorename: true, mute: false } }) },
        body: buffer,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Dropbox: ${await res.text()}` }, { status: 500 });
      const uploaded = (await res.json()) as { path_display: string; size?: number };
      const finalPath = uploaded.path_display;
      const fileSize  = uploaded.size ?? (offset + buffer.length);

      const version = await finalizeMixVersion({ workId, target, finalPath, fileSize, durationSeconds, token });
      return NextResponse.json({ ok: true, version });
    }

    return NextResponse.json({ ok: false, error: "action לא תקין" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/versions/chunk]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
