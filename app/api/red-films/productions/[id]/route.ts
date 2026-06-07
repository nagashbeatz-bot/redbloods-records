/**
 * PATCH /api/red-films/productions/[id]
 * Accepts a partial production object — updates only the provided fields.
 * Always bumps updated_at (same pattern as all other routes in the project).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

// Fields that may be patched — whitelist to prevent injection
const ALLOWED_FIELDS = new Set([
  "title", "production_type", "status",
  "project_id", "client_id",
  "artist_name", "client_name", "client_source",
  "photographer_name", "director_name", "editor_name",
  "shoot_date", "locations",
  "concept_summary", "concept_vibe", "ref_links",
  "script_start", "script_middle", "script_end",
  "director_notes", "photographer_notes",
  "general_budget", "client_price", "advance_required", "advance_received",
  "collection_status",
  "files_raw_link", "files_edit_folder",
  "version_1_link", "version_2_link", "final_version_link",
  "fix_notes", "edit_status", "publish_date", "published_where",
  "notes",
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "id חסר" }, { status: 400 });

    const body = await req.json();

    // Build patch from whitelisted fields only
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const [key, val] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) {
        patch[key] = val;
      }
    }

    if (Object.keys(patch).length === 1) {
      // Only updated_at — nothing to update
      return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("red_films_productions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });

    return NextResponse.json({ production: data });
  } catch (e) {
    console.error("[PATCH /api/red-films/productions/[id]]", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
