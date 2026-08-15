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
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-auth";
import { CLIP_SCOPE } from "@/lib/clip-finance";
import { findLinkedClipProduction } from "@/lib/clip-production";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { id } = await ctx.params;

    // Guard #1 — already linked?
    const existing = await findLinkedClipProduction(id);
    if (existing) {
      return NextResponse.json({ production: existing, created: false });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, artist")
      .eq("id", id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "פרויקט לא נמצא" }, { status: 404 });

    const { data: settingRow } = await supabase
      .from("settings").select("value").eq("key", `finance_${id}`).maybeSingle();
    const settings = (settingRow?.value ?? {}) as Record<string, unknown>;
    const budget   = Number(settings.clipAgreedPrice ?? 0) || 0;

    const artist = (project.artist as string) ?? "";
    const title  = (project.name   as string) ?? "קליפ";

    // Match a client by artist name, the same way the Red Films "new production"
    // modal does when it is opened from an existing project.
    let clientId: string | null = null;
    let clientName = "";
    if (artist) {
      const { data: client } = await supabase
        .from("clients").select("id, name").eq("name", artist).maybeSingle();
      if (client) { clientId = client.id as string; clientName = client.name as string; }
    }

    // Guard #2 — re-check right before the insert (double click / concurrent retry).
    const stillNone = await findLinkedClipProduction(id);
    if (stillNone) {
      return NextResponse.json({ production: stillNone, created: false });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("red_films_productions")
      .insert({
        title,
        production_type:   CLIP_SCOPE,
        status:            "רעיון",
        project_id:        id,          // ← the link back to the project
        artist_name:       artist,
        client_id:         clientId,
        client_name:       clientName,
        photographer_name: "",
        client_source:     "פנימי - לייבל",
        collection_status: "לא רלוונטי",
        general_budget:    budget,      // ← clip price becomes the production budget
        created_at:        now,
        updated_at:        now,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ production: data, created: true }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/projects/[id]/clip/send]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
