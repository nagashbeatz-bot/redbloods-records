import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess, getAuthRole } from "@/lib/require-auth";
import { listMixComments, createMixComment } from "@/lib/mix-comments-store";
import { assertStevenOwnsVersion } from "@/lib/steven-scope";

const FORBID = () => NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

/** GET — comments for a version, ONLY if that version's work is Steven's. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const { versionId } = await params;
    if (!(await assertStevenOwnsVersion(versionId))) return FORBID();
    const comments = await listMixComments(versionId);
    return NextResponse.json({ ok: true, comments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST — add a time-stamped comment. Phase 1: Steven is VIEW-ONLY on comments,
 *  so a steven session is rejected (403) here; only the owner may create. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = await requireStevenAccess(); if (denied) return denied;
  if ((await getAuthRole()) === "steven") return FORBID(); // steven can't create comments
  try {
    const { versionId } = await params;
    if (!(await assertStevenOwnsVersion(versionId))) return FORBID();

    const body = (await req.json()) as { timestampSeconds?: number; commentText?: string; author?: string; role?: string };
    const text = (body.commentText ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "טקסט ההערה חסר" }, { status: 400 });
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
