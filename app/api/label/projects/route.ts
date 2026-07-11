import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { createLabelSongRelease, isValidStage } from "@/lib/release-store";
import { upsertArtistsFromProject } from "@/lib/clients-store";

// POST /api/label/projects — create a NEW label song release.
// Atomically creates the project (project_type="שיר", project_business_type="לייבל")
// AND its project_release_details via the transactional RPC.
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const { name, artist, deadline, notes, parentProject,
            releaseStage, releaseTargetDate, nextAction, blocker, responsible } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "שם הריליס חסר" }, { status: 400 });
    }
    if (releaseStage !== undefined && !isValidStage(releaseStage)) {
      return NextResponse.json({ error: "שלב ריליס לא חוקי" }, { status: 400 });
    }

    const projectId = await createLabelSongRelease({
      name: name.trim(),
      artist: typeof artist === "string" ? artist.trim() : "",
      deadline: deadline || null,
      notes: typeof notes === "string" ? notes.trim() : "",
      parentProject: typeof parentProject === "string" ? parentProject : "",
      releaseStage, releaseTargetDate, nextAction, blocker, responsible,
    });

    // Mirror artists into the clients directory (fire-and-forget) — same as the
    // generic project-create path. Not part of the transaction (non-critical).
    if (typeof artist === "string" && artist.trim()) {
      upsertArtistsFromProject(artist).catch(() => {});
    }

    return NextResponse.json({ ok: true, projectId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/projects POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
