import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listMixComments, createMixComment } from "@/lib/mix-comments-store";

/** GET /api/sound-engineer/versions/[versionId]/comments — list a version's comments. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { versionId } = await params;
    const comments = await listMixComments(versionId);
    return NextResponse.json({ ok: true, comments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST /api/sound-engineer/versions/[versionId]/comments — add a time-stamped comment. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { versionId } = await params;
    const body = (await req.json()) as { timestampSeconds?: number; commentText?: string; author?: string; role?: string };
    const text = (body.commentText ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "טקסט ההערה חסר" }, { status: 400 });

    // role is a display discriminator only ("mix" | "acapella" | "instrumental" | "stems").
    // Anything else (incl. legacy/absent) is stored as null = shared/כללי.
    const role = ["mix", "acapella", "instrumental", "stems"].includes(body.role ?? "") ? body.role! : null;

    const comment = await createMixComment({
      mixVersionId:     versionId,
      timestampSeconds: Number(body.timestampSeconds ?? 0),
      commentText:      text,
      author:           body.author?.trim() || null,
      role,
    });
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
