import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess } from "@/lib/require-auth";
import { getBeat } from "@/lib/beats-store";
import { dropboxAttachment, safeDownloadName, extOf } from "@/lib/audio-download";

export const maxDuration = 60;

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks arbitrary ids / traversal

// GET /api/beats/[id]/download — owner OR shalev. Same-origin attachment (no 302);
// the download filename is the CLEAN beat name + original extension (never the
// stored file_name with its uniqueness token). Raw dropbox_path is never exposed.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireShalevAccess(); if (denied) return denied;

  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  const beat = await getBeat(id);
  if (!beat) return NextResponse.json({ error: "הביט לא נמצא" }, { status: 404 });

  const ext = extOf(beat.fileName) || extOf(beat.dropboxPath);
  const filename = safeDownloadName(beat.name, ext);
  return dropboxAttachment(beat.dropboxPath, filename);
}
