import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { dropboxArg } from "@/lib/mix-version-upload";
import {
  resolveFinalTarget, finalizeFinalFile, validateFinalFileName, FINAL_CONFLICT_MSG,
} from "@/lib/final-file-upload";
import { finalFileNameExists } from "@/lib/final-files-store";

// Chunked (>140MB up to 1GB) final-file upload — OWNER. 8MB chunks stream through the
// Dropbox upload-session; the original filename is kept exactly (no rename). Stored ONLY
// in final_files. The name-clash gate runs at `start` (before any bytes are streamed).
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const sp     = req.nextUrl.searchParams;
    const action = sp.get("action");
    const buffer = Buffer.from(await req.arrayBuffer()); // one chunk only

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();

    // ── start: validate name + dedupe gate, then open the session ──
    if (action === "start") {
      const fileName = (sp.get("fileName") ?? "").trim();
      const nameErr = validateFinalFileName(fileName);
      if (nameErr) return NextResponse.json({ ok: false, error: nameErr }, { status: 400 });
      if (await finalFileNameExists(workId, fileName)) {
        return NextResponse.json({ ok: false, error: FINAL_CONFLICT_MSG }, { status: 409 });
      }
      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ close: false }) },
        body: buffer,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Dropbox: ${await res.text()}` }, { status: 500 });
      const d = (await res.json()) as { session_id: string };
      return NextResponse.json({ ok: true, sessionId: d.session_id });
    }

    // ── append ──
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

    // ── finish: commit to /Final Files/<original name> (autorename:false) + insert ──
    if (action === "finish") {
      const sessionId = sp.get("sessionId") ?? "";
      const offset    = Number(sp.get("offset") ?? "0");
      const fileName  = (sp.get("fileName") ?? "").trim();
      if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId חסר" }, { status: 400 });
      const nameErr = validateFinalFileName(fileName);
      if (nameErr) return NextResponse.json({ ok: false, error: nameErr }, { status: 400 });

      const resolved = await resolveFinalTarget(workId);
      if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
      const dropboxPath = `${resolved.target.folder}/${fileName}`;

      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/finish", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ cursor: { session_id: sessionId, offset }, commit: { path: dropboxPath, mode: "add", autorename: false, mute: false } }) },
        body: buffer,
      });
      if (!res.ok) {
        const t = await res.text();
        if (/conflict/i.test(t)) return NextResponse.json({ ok: false, error: FINAL_CONFLICT_MSG }, { status: 409 });
        return NextResponse.json({ ok: false, error: `Dropbox: ${t}` }, { status: 500 });
      }
      const uploaded = (await res.json()) as { path_display: string; size?: number };
      const fin = await finalizeFinalFile({ workId, target: resolved.target, fileName, finalPath: uploaded.path_display, fileSize: uploaded.size ?? (offset + buffer.length), token });
      if (!fin.ok) return NextResponse.json({ ok: false, error: fin.error }, { status: fin.status });
      return NextResponse.json({ ok: true, file: { id: fin.file.id, fileName: fin.file.fileName } });
    }

    return NextResponse.json({ ok: false, error: "action לא תקין" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/final-files/chunk]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
