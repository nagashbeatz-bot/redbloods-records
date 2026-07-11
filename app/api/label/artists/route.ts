import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listLabelArtists, createLabelArtist } from "@/lib/label-artists-store";
import { LABEL_ARTIST_STATUSES } from "@/lib/types";

// GET /api/label/artists — the canonical label-artist roster.
export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const artists = await listLabelArtists();
    return NextResponse.json(artists);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/label/artists — add a label artist (explicit action only).
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const { name, status, imageUrl, notes } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "שם האמן חסר" }, { status: 400 });
    }
    if (status !== undefined && !LABEL_ARTIST_STATUSES.includes(status)) {
      return NextResponse.json({ error: "סטטוס לא חוקי" }, { status: 400 });
    }

    const result = await createLabelArtist({
      name: name.trim(),
      status,
      imageUrl: typeof imageUrl === "string" ? imageUrl.trim() : null,
      notes: typeof notes === "string" ? notes.trim() : "",
    });
    if (result.status === "duplicate") {
      return NextResponse.json({ error: "אמן בשם זה כבר קיים" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, artist: result.artist });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
