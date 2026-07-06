import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { instructionsFolder, sanitizeFolder } from "@/lib/project-paths";

// Each request carries ONE small chunk (~8MB), never the whole file — so memory
// stays tiny and the proxy body limit is never approached. Large files use the
// Dropbox upload-session API (start → append_v2 → finish).
export const maxDuration = 300;

const WM_CATEGORY = "חומרי עבודה";
type MaterialType = "rough" | "reference" | "stems" | "doc";
const MATERIAL_TYPES: MaterialType[] = ["rough", "reference", "stems", "doc"];
const TYPE_LABEL: Record<MaterialType, string> = { rough: "Rough Mix", reference: "Reference", stems: "Stems", doc: "Instructions" };

const isAudioName   = (n: string) => /\.(wav|mp3|m4a|aiff?|flac|ogg|aac|opus)$/i.test(n || "");
const isArchiveName = (n: string) => /\.(zip|rar|7z)$/i.test(n || "");

/** Escape non-ASCII for the Dropbox-API-Arg header (headers must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

type FileRow = { name?: string; category?: string; versionLabel?: string };

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

    // ── finish: commit the last chunk to the project's /Instructions folder ──
    if (action === "finish") {
      const sessionId    = sp.get("sessionId") ?? "";
      const offset       = Number(sp.get("offset") ?? "0");
      const ext          = (sp.get("ext") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const typeRaw      = (sp.get("materialType") ?? "").trim();
      const materialType = (MATERIAL_TYPES as string[]).includes(typeRaw) ? (typeRaw as MaterialType) : null;
      if (!sessionId)    return NextResponse.json({ ok: false, error: "sessionId חסר" }, { status: 400 });
      if (!materialType) return NextResponse.json({ ok: false, error: "materialType לא תקין" }, { status: 400 });

      // Resolve work → project (work-materials require a linked project).
      const { supabase } = await import("@/lib/supabase");
      const { data: work } = await supabase.from("sound_engineer_work").select("id, project_id").eq("id", workId).maybeSingle();
      if (!work) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
      const projectId = (work.project_id as string | null) ?? null;
      if (!projectId) return NextResponse.json({ ok: false, error: "אין פרויקט מקושר לעבודה" }, { status: 400 });

      const { getProject, addFileToProject } = await import("@/lib/projects-store");
      const project = await getProject(projectId);
      if (!project) return NextResponse.json({ ok: false, error: "פרויקט לא נמצא" }, { status: 404 });
      const artist = project.artist ?? "";
      const projectName = project.name ?? "";

      // Clean physical name — same scheme as the single-shot route: never the
      // uploaded filename. References always numbered; other types get a number
      // only on an exact-name clash (autorename is the net).
      const wmFiles = (project.files as FileRow[]).filter((f) => f.category === WM_CATEGORY);
      const existingNames = new Set(wmFiles.map((f) => f.name ?? ""));
      const typeLabel = TYPE_LABEL[materialType];
      let label = typeLabel;
      if (materialType === "reference") label = `${typeLabel} ${wmFiles.filter((f) => f.versionLabel === "reference").length + 1}`;
      const base = [sanitizeFolder(projectName), label].filter(Boolean).join(" ") || label;
      let cleanName = ext ? `${base}.${ext}` : base;
      for (let n = 2; existingNames.has(cleanName); n++) { const numbered = `${base} ${n}`; cleanName = ext ? `${numbered}.${ext}` : numbered; }

      const dropboxPath = `${instructionsFolder(artist, projectName, project.id, project.dropboxFolder)}/${cleanName}`;

      const res = await fetch("https://content.dropboxapi.com/2/files/upload_session/finish", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ cursor: { session_id: sessionId, offset }, commit: { path: dropboxPath, mode: "add", autorename: true, mute: false } }) },
        body: buffer,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: `Dropbox: ${await res.text()}` }, { status: 500 });
      const uploaded = (await res.json()) as { path_display: string; size?: number };
      const finalPath = uploaded.path_display;

      // Persist to projects.files (single source of truth; no public share link).
      try {
        await addFileToProject(project.id, {
          name: cleanName,
          url: `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`,
          dropboxPath: finalPath,
          category: WM_CATEGORY,
          versionLabel: materialType,
          size: uploaded.size ?? (offset + buffer.length),
        });
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
      // kindOf is display-only; the client reloads to render the row.
      return NextResponse.json({ ok: true, name: cleanName, kind: isArchiveName(cleanName) ? "archive" : isAudioName(cleanName) ? "audio" : "doc" });
    }

    return NextResponse.json({ ok: false, error: "action לא תקין" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[work-materials/chunk]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
