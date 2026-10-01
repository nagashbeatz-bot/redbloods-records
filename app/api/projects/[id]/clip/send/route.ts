/**
 * POST /api/projects/[id]/clip/send — create (or return) the Red Films production
 * for this project's clip.
 *
 * IDEMPOTENT BY CONTRACT: the answer to "does this project already have a clip
 * production?" is a query on the existing red_films_productions.project_id link,
 * and it is asked twice — once up front and once immediately before the insert.
 * A double click, a refresh, or a retry therefore returns the SAME production
 * with created:false instead of making a second one. (There is no DB-level
 * unique index; adding one would require SQL, which is out of scope here.)
 *
 * B3 (Owner canon 2026-09-27): the production starts with a planning budget of 0 in the
 * project's currency — a project's price is never its budget. One clip model (2026-10-01):
 * a clip is its own project with ONE agreedPrice; this route is operational only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { sendClipToRedFilms } from "@/lib/writes/clip";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;

    // Guard #1 — already linked?
    // Shared writer (lib/writes/clip) — find-or-create the managed production (idempotent by lookup twice).
    const r = await sendClipToRedFilms(id);
    if (r.kind === "not_found") return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });
    return r.created ? NextResponse.json({ production: r.production, created: true }, { status: 201 }) : NextResponse.json({ production: r.production, created: false });
  } catch (e) {
    console.error("[POST /api/projects/[id]/clip/send]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
