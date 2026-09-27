import { NextRequest, NextResponse } from "next/server";
import { uploadProjectFile } from "@/lib/writes/uploads";
import { requireOwner } from "@/lib/require-auth";

// Allow up to 5 minutes for large audio file uploads (WAV/FLAC can be 200MB+)
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied; // in-route Owner check (the central gate is the first layer)
  try {
    const formData     = await req.formData();
    const file         = formData.get("file")         as File   | null;
    const projectId    = formData.get("projectId")    as string | null;
    const newName      = formData.get("newName")      as string | null;
    const trackId      = formData.get("trackId")      as string | null;
    const versionLabel = formData.get("versionLabel") as string | null;
    const subfolder    = formData.get("subfolder")    as string | null;
    // Optional audio length (metadata only) — computed client-side.
    const durationRaw    = formData.get("durationSeconds") as string | null;
    const durationParsed = durationRaw != null ? Number(durationRaw) : NaN;
    const durationSeconds = Number.isFinite(durationParsed) && durationParsed > 0 ? Math.round(durationParsed) : undefined;
    if (!file || !projectId || !newName) {
      return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
    }
    // Shared writer (lib/writes/uploads) — the same one Sunny's file channel uses. newName is already built client-side.
    const r = await uploadProjectFile(projectId, file, { newName, subfolder, trackId, versionLabel, durationSeconds });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, shareUrl: r.shareUrl, shareLinkError: r.shareLinkError, file: r.file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[dropbox/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

