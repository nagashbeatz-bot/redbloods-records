import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { mixVersionsFolder, sanitizeFolder } from "@/lib/project-paths";
import { listMixVersions, createMixVersion } from "@/lib/mix-versions-store";

// Large audio files (WAV/FLAC/stems) can take a while.
export const maxDuration = 300;

const AUDIO_ZIP = /\.(wav|mp3|m4a|aiff?|flac|ogg|zip|rar|7z)$/i;

/** Escape non-ASCII for the Dropbox-API-Arg header (headers must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

type RoleKey = "mix" | "acapella" | "instrumental" | "stems";
const ROLE_EN: Record<RoleKey, string> = { mix: "Mix", acapella: "Acapella", instrumental: "Instrumental", stems: "Stems" };

/** Role KEY inferred from the ORIGINAL filename — used only as the fallback when
 *  the client doesn't send an explicit role. Mirrors the client detectRole. */
function roleKeyFromName(name: string): RoleKey {
  const s = (name || "").toLowerCase();
  if (/(\.(zip|rar|7z)$|stems|ערוצים)/.test(s)) return "stems";
  if (/(instrumental|\binst\b|\bbeat\b|karaoke|אינסטרומנטל|אינסטרו|ביט)/.test(s)) return "instrumental";
  if (/(acapella|accapella|acappella|acapela|\bvocals?\b|\bvox\b|אקפלה|אקאפלה|ווקאל|וקאל|שירה)/.test(s)) return "acapella";
  return "mix";
}
/** Resolve the English role label: explicit client role (validated) → else from filename. */
function resolveRoleEn(roleParam: string | null, fileName: string): string {
  const p = (roleParam ?? "").trim().toLowerCase();
  if (p === "mix" || p === "acapella" || p === "instrumental" || p === "stems") return ROLE_EN[p];
  return ROLE_EN[roleKeyFromName(fileName)];
}

/** GET /api/sound-engineer/[id]/versions — list mix versions for a work. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await params;
    const versions = await listMixVersions(id);
    return NextResponse.json({ ok: true, versions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer/[id]/versions — upload a new mix version.
 * Server-side only: Dropbox token never leaves the server. The file goes to the
 * ORIGINAL project's folder under /Mix Versions/ (work_title is NEVER used for
 * the path). Metadata is stored ONLY in mix_versions — never projects.files, and
 * NO public share link is created.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;

    const form  = await req.formData();
    const file  = form.get("file") as File | null;
    const label = ((form.get("label") as string | null) ?? "").trim();
    // When true, this file is being ADDED to an existing logical version (same
    // label, different role file) — so a duplicate label is intentional, not a
    // clash. Absent/false keeps the old guard for the "new version" flow.
    const addToExisting = form.get("addToExisting") != null;
    const roleParam     = form.get("role") as string | null; // explicit per-file role (optional)
    const durationRaw    = form.get("durationSeconds") as string | null;
    const durationParsed = durationRaw != null ? Number(durationRaw) : NaN;
    const durationSeconds = Number.isFinite(durationParsed) && durationParsed > 0 ? Math.round(durationParsed) : null;

    if (!file)                    return NextResponse.json({ ok: false, error: "חסר קובץ" }, { status: 400 });
    if (!AUDIO_ZIP.test(file.name)) return NextResponse.json({ ok: false, error: "סוג קובץ לא נתמך (WAV/MP3/AIFF/M4A/FLAC/OGG/ZIP)" }, { status: 400 });

    // Resolve work → project (for the path). NEVER use work_title here.
    const { supabase } = await import("@/lib/supabase");
    const { data: work } = await supabase
      .from("sound_engineer_work")
      .select("id, project_id, engineer_name")
      .eq("id", workId)
      .maybeSingle();
    if (!work) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });

    const projectId = (work.project_id as string | null) ?? null;
    let artist = "", projectName = "";
    if (projectId) {
      const { getProject } = await import("@/lib/projects-store");
      const project = await getProject(projectId);
      artist      = project?.artist ?? "";
      projectName = project?.name ?? "";
    }

    // Clean, organized physical name: "{artist} - {project} - {label}.{ext}".
    // NEVER the original uploaded filename, NEVER work_title. Standalone works
    // (no project) drop the empty artist/project parts. The DB file_name is this
    // clean name WITHOUT the prefix; dropbox_path keeps a {versionId}- prefix to
    // avoid collisions. If no label was given, fall back to the original base name.
    const versionId = crypto.randomUUID();
    const dot       = file.name.lastIndexOf(".");
    const ext       = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : ""; // only the original extension is reused

    // Existing labels for this work — reject duplicates; pick the next free
    // "Mix N" when no label was given. NEVER fall back to the uploaded filename.
    const { data: existingRows } = await supabase
      .from("mix_versions").select("label, file_name").eq("sound_engineer_work_id", workId);
    const existingLabels = new Set((existingRows ?? []).map(r => (r.label as string)));
    const existingNames  = new Set((existingRows ?? []).map(r => (r.file_name as string)));

    let effectiveLabel = label;
    if (!effectiveLabel) {
      let n = 1;
      while (existingLabels.has(`Mix ${n}`)) n++;
      effectiveLabel = `Mix ${n}`;
    } else if (existingLabels.has(effectiveLabel) && !addToExisting) {
      // Explicit label that collides AND not an intentional add → block (new-version flow).
      return NextResponse.json({ ok: false, error: "כבר קיימת גרסה בשם הזה" }, { status: 409 });
    }

    // Clean, readable physical name (NO versionId): "{primaryArtist} - {project}
    // - {label}.{ext}" — never the uploaded filename, never work_title. Standalone
    // works drop the empty artist/project parts. The file lives DIRECTLY under
    // Mix Versions (no per-label subfolder); uniqueness comes from the unique
    // label baked into the file name.
    const safeLabel     = sanitizeFolder(effectiveLabel) || "Mix";
    // Clean, uniform name: "{projectName} - {versionLabel} - {roleEn}.{ext}". The
    // ORIGINAL uploaded filename is NEVER included (only its extension is reused).
    // projectName is the ORIGINAL project (never work_title / Steven display);
    // filter(Boolean) drops it for standalone works so there's no leading " - ".
    // Same role+ext already in this version → append " 2"/" 3" (autorename is the
    // extra safety net). The role picker's choice drives roleEn.
    const roleEn        = resolveRoleEn(roleParam, file.name);
    const roleBase      = [projectName, effectiveLabel, roleEn]
      .map(s => sanitizeFolder(s)).filter(Boolean).join(" - ") || safeLabel;
    let cleanFileName   = ext ? `${roleBase}.${ext}` : roleBase;
    for (let n = 2; existingNames.has(cleanFileName); n++) {
      cleanFileName = ext ? `${roleBase} ${n}.${ext}` : `${roleBase} ${n}`;
    }

    const folder      = mixVersionsFolder({ projectId, artist, projectName, workId });
    const dropboxPath = `${folder}/${cleanFileName}`;

    // ── Upload to Dropbox (token server-side; no share link) ──────────────────
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token  = await getDropboxToken();
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${token}`,
        "Content-Type":    "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({ path: dropboxPath, mode: "add", autorename: true, mute: false }),
      },
      body: buffer,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      let detail = t; try { detail = JSON.parse(t)?.error_summary ?? t; } catch {}
      return NextResponse.json({ ok: false, error: `Dropbox: ${detail}` }, { status: 500 });
    }
    const uploaded  = (await uploadRes.json()) as { path_display: string; name: string };
    const finalPath = uploaded.path_display;

    const fileType = ["wav", "mp3", "m4a", "aiff", "aif", "flac", "ogg"].includes(ext)
      ? ext : (ext === "zip" ? "zip" : "other");

    // ── Persist metadata ONLY in mix_versions ─────────────────────────────────
    try {
      const version = await createMixVersion({
        id:                  versionId,
        soundEngineerWorkId: workId,
        projectId,
        label:               effectiveLabel,   // clean label, e.g. "Mix 1"
        fileName:            cleanFileName,     // clean, no versionId prefix
        dropboxPath:         finalPath,
        fileSize:            file.size,
        fileType,
        uploadedBy:          (work.engineer_name as string | null) ?? null,
        durationSeconds,
      });
      return NextResponse.json({ ok: true, version });
    } catch (dbErr) {
      // Compensating: DB insert failed after upload → delete the orphaned file.
      try {
        await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: finalPath }),
        });
      } catch { /* best-effort */ }
      throw dbErr;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sound-engineer/versions POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
