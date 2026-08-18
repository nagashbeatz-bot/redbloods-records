import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getBeat, listBeatAssignments, assignBeatToArtist, unassignBeatFromArtist } from "@/lib/beats-store";
import { isPortalSlug } from "@/lib/red-artists/portal-registry";

/**
 * Which artists a beat is shown to. OWNER ONLY on every method — an artist can
 * neither read nor change assignments (their own portal list is scoped for them
 * by /api/beats, and this path is not on any artist's proxy allowlist).
 *
 * Assigning copies nothing: it writes one beat_artist_assignments row. Removing
 * deletes ONLY that row — the beats row and the Dropbox file are never touched.
 *
 * GET    /api/beats/[id]/assignments            → { artistSlugs: [...] }
 * POST   /api/beats/[id]/assignments  { slug }  → assign   (idempotent)
 * DELETE /api/beats/[id]/assignments?slug=...   → unassign (idempotent)
 */

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks arbitrary ids / traversal

/** Never trust a slug from the client: it must be a registered portal artist. */
function badSlug(slug: string | null): NextResponse | null {
  if (!slug || !isPortalSlug(slug)) {
    return NextResponse.json({ error: "אמן לא מוכר" }, { status: 400 });
  }
  return null;
}

async function resolveBeat(id: string): Promise<NextResponse | null> {
  if (!ID_RE.test(id)) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
  const beat = await getBeat(id);
  if (!beat) return NextResponse.json({ error: "הביט לא נמצא" }, { status: 404 });
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await params;
  const bad = await resolveBeat(id); if (bad) return bad;
  try {
    return NextResponse.json({ ok: true, artistSlugs: await listBeatAssignments(id) });
  } catch (err) {
    console.error("[beats/assignments] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await params;
  const bad = await resolveBeat(id); if (bad) return bad;
  const body = (await req.json().catch(() => ({}))) as { artistSlug?: string };
  const slug = (body.artistSlug ?? "").trim();
  const invalid = badSlug(slug); if (invalid) return invalid;
  try {
    await assignBeatToArtist(id, slug);
    return NextResponse.json({ ok: true, artistSlugs: await listBeatAssignments(id) });
  } catch (err) {
    console.error("[beats/assignments] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "השיוך נכשל, נסה שוב" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await params;
  const bad = await resolveBeat(id); if (bad) return bad;
  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim();
  const invalid = badSlug(slug); if (invalid) return invalid;
  try {
    await unassignBeatFromArtist(id, slug);
    return NextResponse.json({ ok: true, artistSlugs: await listBeatAssignments(id) });
  } catch (err) {
    console.error("[beats/assignments] DELETE", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "ביטול השיוך נכשל, נסה שוב" }, { status: 500 });
  }
}
