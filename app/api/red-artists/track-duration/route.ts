import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getProject, setFileDuration } from "@/lib/projects-store";

/**
 * POST /api/red-artists/track-duration
 * Body: { projectId, dropboxPath, durationSeconds }
 *
 * Narrow, owner-only metadata backfill: stores the audio length of ONE file in
 * projects.files.durationSeconds — but ONLY when the project belongs to Shalev
 * (artist token "שליו טסמה", same rule as getShalevMusicProjects) and only if
 * that field is currently missing (idempotent). This is the ONE approved
 * exception to "Red Artists never writes to Projects" — durationSeconds ONLY.
 */

const SHALEV = "שליו טסמה";
const norm = (s: string) => (s ?? "").trim().replace(/\s+/g, " ");
function isShalevProject(artist: string): boolean {
  return (artist ?? "").split(/[,،;]/).map(norm).filter(Boolean).includes(norm(SHALEV));
}

export async function POST(req: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const projectId   = typeof body.projectId   === "string" ? body.projectId   : "";
    const dropboxPath = typeof body.dropboxPath === "string" ? body.dropboxPath : "";
    const raw         = Number(body.durationSeconds);
    const seconds     = Number.isFinite(raw) ? Math.round(raw) : NaN;

    if (!projectId || !dropboxPath || !Number.isFinite(seconds) || seconds <= 0 || seconds >= 86400) {
      return NextResponse.json({ ok: false, error: "invalid params" }, { status: 400 });
    }

    const project = await getProject(projectId);
    if (!project) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (!isShalevProject(project.artist)) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const updated = await setFileDuration(projectId, dropboxPath, seconds);
    return NextResponse.json({ ok: true, updated, durationSeconds: seconds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "server error";
    console.error("[red-artists/track-duration]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
