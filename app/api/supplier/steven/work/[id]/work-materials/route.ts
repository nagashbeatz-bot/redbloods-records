import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { listMixVersions } from "@/lib/mix-versions-store";
import { assertStevenOwnsWork } from "@/lib/steven-scope";
import type { WorkMaterialsMeta } from "@/lib/types";

export const maxDuration = 120;

const WM_CATEGORY = "חומרי עבודה";
const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

const isAudioName   = (n: string) => /\.(wav|mp3|m4a|aiff?|flac|ogg|aac|opus)$/i.test(n || "");
const isArchiveName = (n: string) => /\.(zip|rar|7z)$/i.test(n || "");
const looksNonMix   = (n: string) =>
  /(acapella|accapella|acappella|acapela|vocals?|vox|instrumental|\binst\b|beat|karaoke|אקפלה|אקאפלה|ווקאל|וקאל|שירה|אינסטרומנטל|אינסטרו|ביט|ערוצים)/i.test(n || "");
function kindOf(name: string): "audio" | "archive" | "doc" {
  if (isAudioName(name)) return "audio";
  if (isArchiveName(name)) return "archive";
  return "doc";
}

type MaterialType = "rough" | "reference" | "stems" | "doc";
const MATERIAL_TYPES: MaterialType[] = ["rough", "reference", "stems", "doc"];
type FileRow = { name?: string; dropboxPath?: string; category?: string; versionLabel?: string; durationSeconds?: number; size?: number };

/**
 * GET /api/supplier/steven/work/[id]/work-materials — READ-ONLY. Returns what
 * Redbloods sent Steven for this work (files in category "חומרי עבודה", the
 * BPM/Key/instructions text, and the latest mix for the A/B compare). Every file
 * URL is opaque (?workId&name / ?versionId) and resolved+ownership-checked by the
 * steven stream route — NO raw Dropbox path ever leaves the server. 403 for any
 * non-Steven work. There is NO POST/DELETE (materials are owner-managed).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { id: workId } = await params;
    const work = await assertStevenOwnsWork(workId);
    if (!work) return FORBID();

    if (!work.projectId) {
      return NextResponse.json({ ok: true, projectLinked: false, materials: [], meta: {}, latestMix: null });
    }

    const { getProject } = await import("@/lib/projects-store");
    const project = await getProject(work.projectId);
    if (!project) return NextResponse.json({ ok: true, projectLinked: false, materials: [], meta: {}, latestMix: null });

    const materials = (project.files as FileRow[])
      .filter((f) => f.category === WM_CATEGORY)
      .map((f) => {
        const name = f.name ?? "";
        const mt = (f.versionLabel && (MATERIAL_TYPES as string[]).includes(f.versionLabel))
          ? (f.versionLabel as MaterialType)
          : (isArchiveName(name) ? "stems" : isAudioName(name) ? "reference" : "doc");
        return {
          name,
          url: `/api/supplier/steven/stream?workId=${encodeURIComponent(workId)}&name=${encodeURIComponent(name)}`,
          dropboxPath: "",                 // never exposed to Steven
          materialType: mt,
          kind: kindOf(name),
          durationSeconds: f.durationSeconds ?? null,
          size: f.size ?? null,
        };
      });

    // Latest mix Steven uploaded — opaque stream by versionId.
    let latestMix: { url: string; fileName: string; label: string; durationSeconds: number | null } | null = null;
    try {
      const versions = await listMixVersions(workId);
      const audio = versions.filter((v) => isAudioName(v.fileName));
      const pick = audio.find((v) => !looksNonMix(v.fileName) && !looksNonMix(v.label)) ?? audio[0] ?? null;
      if (pick) latestMix = {
        url: `/api/supplier/steven/stream?versionId=${encodeURIComponent(pick.id)}`,
        fileName: pick.fileName, label: pick.label, durationSeconds: pick.durationSeconds,
      };
    } catch { /* best-effort */ }

    const meta = (project.workMaterials ?? {}) as WorkMaterialsMeta;
    return NextResponse.json({ ok: true, projectLinked: true, materials, meta, latestMix });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
