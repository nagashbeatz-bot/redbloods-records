import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getMixComment } from "@/lib/mix-comments-store";
import { getMixVersion } from "@/lib/mix-versions-store";
import { getSoundEngineerWork } from "@/lib/sound-engineer-store";
import { getProject } from "@/lib/projects-store";
import { commentAttachmentsFolder, sanitizeFolder } from "@/lib/project-paths";
import { createAttachment } from "@/lib/mix-comment-attachments-store";

export const maxDuration = 60;

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// M4A in particular is reported inconsistently across browsers/OSes.
const ALLOWED_AUDIO_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave", "audio/mp4", "audio/x-m4a"]);
const AUDIO_EXT_FALLBACK_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
const MAX_SIZE = 10 * 1024 * 1024; // 10MB — same limit for images and audio.

/**
 * Resolve the attachment's real kind + the MIME to store. `file.type` is the
 * source of truth whenever the browser actually reported one — a mismatched
 * MIME is rejected even if the extension looks right (never let a ".mp3" name
 * wave through a file the browser itself typed as something else). Extension
 * is used ONLY as a fallback when the browser reported no type at all, which
 * happens often enough for M4A specifically.
 */
function resolveAttachment(file: File): { ok: true; kind: "image" | "audio"; mimeType: string } | { ok: false } {
  if (file.type) {
    if (ALLOWED_IMAGE_MIME.has(file.type)) return { ok: true, kind: "image", mimeType: file.type };
    if (ALLOWED_AUDIO_MIME.has(file.type)) return { ok: true, kind: "audio", mimeType: file.type };
    return { ok: false };
  }
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const fallbackMime = AUDIO_EXT_FALLBACK_MIME[ext];
  if (fallbackMime) return { ok: true, kind: "audio", mimeType: fallbackMime };
  return { ok: false };
}

function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/**
 * POST /api/sound-engineer/comments/[commentId]/attachments — upload one image
 * or short audio file and attach it to an existing comment. Owner-only. The
 * comment must already exist (create the comment first, THEN attach files —
 * see the client flow in StevenProfilePage). Server re-validates type/size
 * regardless of what the client already checked; the client check is UX only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { commentId } = await params;
    const comment = await getMixComment(commentId);
    if (!comment) return NextResponse.json({ ok: false, error: "הערה לא נמצאה" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "חסר קובץ" }, { status: 400 });
    const resolved = resolveAttachment(file);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: "סוג קובץ לא נתמך — jpeg/png/webp/gif או mp3/wav/m4a בלבד" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, error: "הקובץ גדול מדי (מקסימום 10MB)" }, { status: 413 });
    }

    const version = await getMixVersion(comment.mixVersionId);
    if (!version) return NextResponse.json({ ok: false, error: "גרסה לא נמצאה" }, { status: 404 });
    const work = await getSoundEngineerWork(version.soundEngineerWorkId);
    if (!work) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });

    let artist = "", projectName = "", dropboxFolder: string | null = null;
    if (work.projectId) {
      const project = await getProject(work.projectId);
      artist = project?.artist ?? "";
      projectName = project?.name ?? "";
      dropboxFolder = project?.dropboxFolder ?? null;
    }
    const folder = commentAttachmentsFolder({
      projectId: work.projectId, artist, projectName, workId: work.id,
      dropboxFolder, mixVersionId: version.id, commentId,
    });

    const sanitizedName = sanitizeFolder(file.name) || (resolved.kind === "audio" ? "audio" : "image");
    const dropboxPath = `${folder}/${sanitizedName}`;

    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({ path: dropboxPath, mode: "add", autorename: true, mute: true }),
      },
      body: buffer,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[comments/attachments] Dropbox upload error:", errText);
      return NextResponse.json({ ok: false, error: "שגיאה בהעלאת הקובץ" }, { status: 500 });
    }
    const uploaded = (await uploadRes.json()) as { path_display: string };

    const attachment = await createAttachment({
      commentId,
      dropboxPath: uploaded.path_display,
      fileName:    file.name,
      fileSize:    file.size,
      mimeType:    resolved.mimeType,
      uploadedBy:  "owner",
    });

    return NextResponse.json({ ok: true, attachment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[comments/attachments POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
