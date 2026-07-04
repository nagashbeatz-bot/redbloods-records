import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { instructionsFolder, sanitizeFolder } from "@/lib/project-paths";
import { listMixVersions } from "@/lib/mix-versions-store";
import type { WorkMaterialsMeta } from "@/lib/types";

// Large audio / stems can take a while.
export const maxDuration = 300;

// Files sent TO the engineer live in projects.files with THIS exact category, so
// the filter is a strict equality (never collides with intake/delivery categories).
const WM_CATEGORY = "חומרי עבודה";

type MaterialType = "rough" | "reference" | "stems" | "doc";
const MATERIAL_TYPES: MaterialType[] = ["rough", "reference", "stems", "doc"];
// Clean, English display label baked into the stored Dropbox filename.
const TYPE_LABEL: Record<MaterialType, string> = {
  rough: "Rough Mix", reference: "Reference", stems: "Stems", doc: "Instructions",
};

const isAudioName   = (n: string) => /\.(wav|mp3|m4a|aiff?|flac|ogg|aac|opus)$/i.test(n || "");
const isArchiveName = (n: string) => /\.(zip|rar|7z)$/i.test(n || "");
/** A version filename that clearly is NOT the main mix (used to pick "Latest Mix"). */
const looksNonMix = (n: string) =>
  /(acapella|accapella|acappella|acapela|vocals?|vox|instrumental|\binst\b|beat|karaoke|אקפלה|אקאפלה|ווקאל|וקאל|שירה|אינסטרומנטל|אינסטרו|ביט|ערוצים)/i.test(n || "");

function kindOf(name: string): "audio" | "archive" | "doc" {
  if (isAudioName(name)) return "audio";
  if (isArchiveName(name)) return "archive";
  return "doc";
}

/** Escape non-ASCII for the Dropbox-API-Arg header (headers must be pure ASCII). */
function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/** Resolve a work id → its linked project (or null for a standalone work). */
async function resolveProject(workId: string) {
  const { supabase } = await import("@/lib/supabase");
  const { data: work } = await supabase
    .from("sound_engineer_work")
    .select("id, project_id")
    .eq("id", workId)
    .maybeSingle();
  if (!work) return { found: false as const };
  const projectId = (work.project_id as string | null) ?? null;
  if (!projectId) return { found: true as const, project: null };
  const { getProject } = await import("@/lib/projects-store");
  const project = await getProject(projectId);
  return { found: true as const, project };
}

type FileRow = {
  name?: string; url?: string; dropboxPath?: string; category?: string;
  versionLabel?: string; durationSeconds?: number; size?: number;
};

function toMaterial(f: FileRow) {
  const name = f.name ?? "";
  const mt = (f.versionLabel && (MATERIAL_TYPES as string[]).includes(f.versionLabel))
    ? (f.versionLabel as MaterialType)
    : (isArchiveName(name) ? "stems" : isAudioName(name) ? "reference" : "doc");
  return {
    name,
    url: f.url ?? (f.dropboxPath ? `/api/dropbox/stream?path=${encodeURIComponent(f.dropboxPath)}` : ""),
    dropboxPath: f.dropboxPath ?? "",
    materialType: mt,
    kind: kindOf(name),
    durationSeconds: f.durationSeconds ?? null,
    size: f.size ?? null,
  };
}

/**
 * GET /api/sound-engineer/[id]/work-materials
 * Returns the materials Redbloods SENT to the engineer for this work's project:
 * files (category "חומרי עבודה"), the BPM/Key/instructions text, and the latest
 * mix the engineer uploaded (for the quick-compare player). Owner only.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const r = await resolveProject(workId);
    if (!r.found) return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
    if (!r.project) {
      return NextResponse.json({ ok: true, projectLinked: false, materials: [], meta: {}, latestMix: null });
    }

    const materials = (r.project.files as FileRow[])
      .filter((f) => f.category === WM_CATEGORY)
      .map(toMaterial);

    // Latest mix the engineer uploaded — newest audio version, preferring a real
    // "mix" (skip acapella/instrumental/stems) for the comparison player.
    let latestMix: { url: string; fileName: string; label: string; durationSeconds: number | null } | null = null;
    try {
      const versions = await listMixVersions(workId); // created_at desc
      const audio = versions.filter((v) => isAudioName(v.fileName));
      const pick = audio.find((v) => !looksNonMix(v.fileName) && !looksNonMix(v.label)) ?? audio[0] ?? null;
      if (pick) latestMix = { url: pick.url, fileName: pick.fileName, label: pick.label, durationSeconds: pick.durationSeconds };
    } catch { /* comparison is best-effort */ }

    const meta = (r.project.workMaterials ?? {}) as WorkMaterialsMeta;
    return NextResponse.json({ ok: true, projectLinked: true, materials, meta, latestMix });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer/[id]/work-materials  (multipart)
 * Upload ONE work-material file into the project's /Instructions folder and
 * record it in projects.files with category "חומרי עבודה". Server-side token,
 * NO public share link. Owner only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const typeRaw = ((form.get("materialType") as string | null) ?? "").trim();
    const materialType = (MATERIAL_TYPES as string[]).includes(typeRaw) ? (typeRaw as MaterialType) : null;
    const durationRaw = form.get("durationSeconds") as string | null;
    const durationParsed = durationRaw != null ? Number(durationRaw) : NaN;
    const durationSeconds = Number.isFinite(durationParsed) && durationParsed > 0 ? Math.round(durationParsed) : undefined;

    if (!file)          return NextResponse.json({ ok: false, error: "חסר קובץ" }, { status: 400 });
    if (!materialType)  return NextResponse.json({ ok: false, error: "materialType לא תקין" }, { status: 400 });

    const r = await resolveProject(workId);
    if (!r.found)   return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
    if (!r.project) return NextResponse.json({ ok: false, error: "אין פרויקט מקושר לעבודה — חומרי עבודה זמינים רק לעבודה עם פרויקט" }, { status: 400 });

    const project = r.project;
    const artist = project.artist ?? "";
    const projectName = project.name ?? "";

    // Clean physical name: "{projectName} {TypeLabel}[ n].{ext}" — never the
    // uploaded filename (only its extension is reused). Numbering avoids clashes
    // within the same material type; autorename is the final safety net.
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
    const wmFiles = (project.files as FileRow[]).filter((f) => f.category === WM_CATEGORY);
    const existingNames = new Set(wmFiles.map((f) => f.name ?? ""));

    // References are ALWAYS numbered ("{project} Reference 1", "… Reference 2", …);
    // the other types use a bare label ("{project} Rough Mix", "… Stems") and only
    // get a trailing number on an exact-name clash. autorename is the final net.
    const typeLabel = TYPE_LABEL[materialType];
    let label = typeLabel;
    if (materialType === "reference") {
      const n = wmFiles.filter((f) => f.versionLabel === "reference").length + 1;
      label = `${typeLabel} ${n}`;
    }
    const base = [sanitizeFolder(projectName), label].filter(Boolean).join(" ") || label;
    let cleanName = ext ? `${base}.${ext}` : base;
    for (let n = 2; existingNames.has(cleanName); n++) {
      const numbered = `${base} ${n}`;
      cleanName = ext ? `${numbered}.${ext}` : numbered;
    }

    const folder = instructionsFolder(artist, projectName, project.id);
    const dropboxPath = `${folder}/${cleanName}`;

    // ── Upload to Dropbox (token stays server-side; no share link) ─────────────
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    const token = await getDropboxToken();
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({ path: dropboxPath, mode: "add", autorename: true, mute: false }),
      },
      body: buffer,
    });
    if (!uploadRes.ok) {
      const tx = await uploadRes.text();
      let detail = tx; try { detail = JSON.parse(tx)?.error_summary ?? tx; } catch {}
      return NextResponse.json({ ok: false, error: `Dropbox: ${detail}` }, { status: 500 });
    }
    const uploaded = (await uploadRes.json()) as { path_display: string; name: string };
    const finalPath = uploaded.path_display;

    // ── Persist to projects.files (single source of truth; no duplicate) ───────
    try {
      const { addFileToProject } = await import("@/lib/projects-store");
      await addFileToProject(project.id, {
        name: cleanName,
        url: `/api/dropbox/stream?path=${encodeURIComponent(finalPath)}`,
        dropboxPath: finalPath,
        category: WM_CATEGORY,
        versionLabel: materialType,   // sub-type: rough | reference | stems | doc
        size: file.size,
        ...(durationSeconds ? { durationSeconds } : {}),
      });
    } catch (dbErr) {
      // Compensating delete so we never orphan a file without a DB record.
      try {
        await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: finalPath }),
        });
      } catch { /* best-effort */ }
      throw dbErr;
    }

    return NextResponse.json({
      ok: true,
      material: toMaterial({ name: cleanName, dropboxPath: finalPath, category: WM_CATEGORY, versionLabel: materialType, durationSeconds, size: file.size }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[work-materials POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/sound-engineer/[id]/work-materials  (json)
 * Merge-update the BPM / Key / instructions text. Owner only.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const body = await req.json().catch(() => ({})) as Partial<WorkMaterialsMeta>;

    const patch: WorkMaterialsMeta = {};
    if (typeof body.bpm === "string")          patch.bpm = body.bpm.trim();
    if (typeof body.key === "string")          patch.key = body.key.trim();
    if (typeof body.instructions === "string") patch.instructions = body.instructions;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "אין שדות לעדכון" }, { status: 400 });
    }

    const r = await resolveProject(workId);
    if (!r.found)   return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
    if (!r.project) return NextResponse.json({ ok: false, error: "אין פרויקט מקושר לעבודה" }, { status: 400 });

    const { updateProjectWorkMaterials } = await import("@/lib/projects-store");
    await updateProjectWorkMaterials(r.project.id, patch);
    return NextResponse.json({ ok: true, meta: { ...(r.project.workMaterials ?? {}), ...patch } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/sound-engineer/[id]/work-materials?path=<dropboxPath>
 * Remove a work-material file (Dropbox + projects.files). Guarded so only a file
 * that is actually a work-material of THIS work's project can be deleted. Owner only.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const path = req.nextUrl.searchParams.get("path");
    if (!path) return NextResponse.json({ ok: false, error: "חסר path" }, { status: 400 });

    const r = await resolveProject(workId);
    if (!r.found)   return NextResponse.json({ ok: false, error: "עבודה לא נמצאה" }, { status: 404 });
    if (!r.project) return NextResponse.json({ ok: false, error: "אין פרויקט מקושר לעבודה" }, { status: 400 });

    // Only allow deleting a file that is a work-material of this project.
    const target = (r.project.files as FileRow[]).find(
      (f) => f.dropboxPath === path && f.category === WM_CATEGORY
    );
    if (!target) return NextResponse.json({ ok: false, error: "הקובץ אינו חומר עבודה של הפרויקט" }, { status: 404 });

    // Delete from Dropbox (best-effort), then remove the DB record.
    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
    } catch { /* non-fatal — still drop the DB record below */ }

    const { removeFileFromProjectByPath } = await import("@/lib/projects-store");
    await removeFileFromProjectByPath(r.project.id, path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
