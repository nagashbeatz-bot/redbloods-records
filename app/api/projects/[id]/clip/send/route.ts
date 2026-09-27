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
 * The agreed clip price is copied into general_budget (תקציב) so the owner never
 * types the same number twice. From then on the project's clipAgreedPrice stays
 * the source of truth and pushes updates one-way (see /api/projects/[id]/clip).
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
