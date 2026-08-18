import { NextRequest, NextResponse } from "next/server";
import { getAuthRole } from "@/lib/require-auth";
import { getBeat, isBeatAssignedTo } from "@/lib/beats-store";
import { beatScopeForRole } from "@/lib/beat-scope";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";

export const maxDuration = 60;

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks arbitrary ids / traversal

// GET /api/beats/[id]/download — owner (any beat) OR an artist portal, ONLY for a
// beat assigned to that artist. Same-origin attachment (no 302);
// the download filename is the CLEAN beat name + original extension (never the
// stored file_name with its uniqueness token). Raw dropbox_path is never exposed.
/** Owner → any beat. Artist → ONLY a beat assigned to them. Anyone else → denied. */
async function denyIfBeatNotAllowed(beatId: string): Promise<NextResponse | null> {
  const role = await getAuthRole();
  const scope = beatScopeForRole(role, null);
  if (scope.kind === "denied") return NextResponse.json({ error: scope.reason }, { status: scope.status });
  if (scope.kind === "central") return null;                     // owner
  const allowed = await isBeatAssignedTo(beatId, scope.artistSlug);
  return allowed ? null : NextResponse.json({ error: "הביט לא נמצא" }, { status: 404 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  const denied = await denyIfBeatNotAllowed(id); if (denied) return denied;

  const beat = await getBeat(id);
  if (!beat) return NextResponse.json({ error: "הביט לא נמצא" }, { status: 404 });

  const ext = extOf(beat.fileName) || extOf(beat.dropboxPath);
  const filename = safeDownloadName(beat.name, ext);
  return dropboxAttachment(beat.dropboxPath, filename);
}
