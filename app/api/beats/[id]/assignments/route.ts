import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getBeat, listBeatAssignments, assignBeatToArtist, unassignBeatFromArtist, isBeatAssignedTo, type Beat } from "@/lib/beats-store";
import { isPortalSlug } from "@/lib/red-artists/portal-registry";
import { notifyBeatAssigned, type BeatAssignNotifyResult } from "@/lib/beat-notify";

/**
 * Which artists a beat is shown to. OWNER ONLY on every method — an artist can
 * neither read nor change assignments (their own portal list is scoped for them
 * by /api/beats, and this path is not on any artist's proxy allowlist).
 *
 * Assigning copies nothing: it writes one beat_artist_assignments row. Removing
 * deletes ONLY that row — the beats row and the Dropbox file are never touched.
 *
 * POST is ALSO the one and only trigger for the artist's "ביט חדש מחכה לך" push +
 * bell entry (lib/beat-notify.ts). It fires only for an assignment that did NOT
 * exist a moment ago and only after the row is confirmed persisted, so a re-click
 * on an already-assigned artist sends nothing at all.
 *
 * GET    /api/beats/[id]/assignments            → { artistSlugs: [...] }
 * POST   /api/beats/[id]/assignments  { slug }  → assign   (idempotent) + notify
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

/** Validate the id and load the beat — POST needs the row itself (its name goes
 *  into the artist's notification), GET/DELETE only need the existence check. */
type ResolvedBeat = { ok: true; beat: Beat } | { ok: false; response: NextResponse };

async function resolveBeat(id: string): Promise<ResolvedBeat> {
  if (!ID_RE.test(id)) return { ok: false, response: NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 }) };
  const beat = await getBeat(id);
  if (!beat) return { ok: false, response: NextResponse.json({ error: "הביט לא נמצא" }, { status: 404 }) };
  return { ok: true, beat };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await params;
  const resolved = await resolveBeat(id); if (!resolved.ok) return resolved.response;
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
  const resolved = await resolveBeat(id); if (!resolved.ok) return resolved.response;
  const body = (await req.json().catch(() => ({}))) as { artistSlug?: string };
  const slug = (body.artistSlug ?? "").trim();
  const invalid = badSlug(slug); if (invalid) return invalid;
  try {
    // Read BEFORE the write: the upsert is ignoreDuplicates, so afterwards it can
    // no longer tell us whether this click created the assignment or found it
    // already there. This single read is what makes the notification exactly-once
    // — a re-click on an artist who is already assigned notifies nobody.
    const alreadyAssigned = await isBeatAssignedTo(id, slug);

    await assignBeatToArtist(id, slug);
    const artistSlugs = await listBeatAssignments(id);

    // Notify ONLY on a brand-new assignment that is confirmed persisted (the slug
    // is present in the list we just re-read from the DB). Never on a duplicate,
    // never before the row exists, never for any artist other than this one.
    let notification: BeatAssignNotifyResult | null = null;
    if (!alreadyAssigned && artistSlugs.includes(slug)) {
      notification = await notifyBeatAssigned(resolved.beat, slug);
    }

    return NextResponse.json({ ok: true, artistSlugs, notification });
  } catch (err) {
    console.error("[beats/assignments] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "השיוך נכשל, נסה שוב" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner(); if (denied) return denied;
  const { id } = await params;
  const resolved = await resolveBeat(id); if (!resolved.ok) return resolved.response;
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
