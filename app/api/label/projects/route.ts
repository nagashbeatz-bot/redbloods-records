import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { createLabelSongRelease, isValidStage } from "@/lib/release-store";

// POST /api/label/projects — create a NEW label song release for an EXISTING artist.
// Atomically creates the project (project_type="שיר", project_business_type="לייבל",
// artist = the chosen label artist's name) AND its project_release_details (with
// label_artist_id) via the transactional RPC. Never creates a new artist.
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const { labelArtistId, name, deadline, notes, parentProject,
            releaseStage, releaseTargetDate, nextAction, blocker, responsible } = body;

    if (!labelArtistId || typeof labelArtistId !== "string") {
      return NextResponse.json({ error: "יש לבחור אמן לייבל" }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "שם הריליס חסר" }, { status: 400 });
    }
    if (releaseStage !== undefined && !isValidStage(releaseStage)) {
      return NextResponse.json({ error: "שלב ריליס לא חוקי" }, { status: 400 });
    }

    const projectId = await createLabelSongRelease({
      labelArtistId,
      name: name.trim(),
      deadline: deadline || null,
      notes: typeof notes === "string" ? notes.trim() : "",
      parentProject: typeof parentProject === "string" ? parentProject : "",
      releaseStage, releaseTargetDate, nextAction, blocker, responsible,
    });

    return NextResponse.json({ ok: true, projectId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/projects POST]", msg);
    // RPC raises "אמן לייבל לא נמצא" when the id is invalid.
    const status = msg.includes("אמן לייבל לא נמצא") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
