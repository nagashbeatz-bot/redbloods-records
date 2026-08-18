import { NextRequest, NextResponse } from "next/server";
import { getAuthRole } from "@/lib/require-auth";
import { getBeat, isBeatAssignedTo } from "@/lib/beats-store";
import { beatScopeForRole } from "@/lib/beat-scope";

const ID_RE = /^[0-9a-fA-F-]{36}$/; // uuid — blocks arbitrary ids / traversal

// GET /api/beats/[id]/stream — owner (any beat) OR an artist portal, listen-only
// and ONLY for a beat assigned to that artist. Resolves the beat's
// Dropbox file to a short-lived temporary link and 302-redirects; the global
// <audio> element follows to the Dropbox CDN. The raw Dropbox path is never sent.
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

  let token: string;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    token = await getDropboxToken();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dropbox לא מחובר" }, { status: 500 });
  }

  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: beat.dropboxPath }),
  });
  if (!res.ok) {
    console.error("[beats/stream]", await res.text().catch(() => ""));
    return NextResponse.json({ error: "שגיאה בטעינת הקובץ" }, { status: 502 });
  }
  const data = (await res.json()) as { link: string };
  return NextResponse.redirect(data.link, 302);
}
