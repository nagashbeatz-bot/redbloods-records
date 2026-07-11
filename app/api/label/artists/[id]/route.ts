import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getLabelArtist, updateLabelArtist } from "@/lib/label-artists-store";
import { listReleasesByArtist } from "@/lib/release-store";
import { LABEL_ARTIST_STATUSES } from "@/lib/types";

// GET /api/label/artists/[id] — one artist + all their releases.
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const artist = await getLabelArtist(id);
    if (!artist) return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });
    const releases = await listReleasesByArtist(id);
    return NextResponse.json({ artist, releases });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id] GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/label/artists/[id] — edit artist fields (name / status / image / notes).
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { name, status, imageUrl, notes } = body;

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return NextResponse.json({ error: "שם האמן לא תקין" }, { status: 400 });
    }
    if (status !== undefined && !LABEL_ARTIST_STATUSES.includes(status)) {
      return NextResponse.json({ error: "סטטוס לא חוקי" }, { status: 400 });
    }

    const result = await updateLabelArtist(id, {
      name: name !== undefined ? name.trim() : undefined,
      status,
      imageUrl: imageUrl !== undefined ? (typeof imageUrl === "string" ? imageUrl.trim() : null) : undefined,
      notes,
    });
    if (result.status === "not_found") return NextResponse.json({ error: "האמן לא נמצא" }, { status: 404 });
    if (result.status === "duplicate") return NextResponse.json({ error: "אמן בשם זה כבר קיים" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id] PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
