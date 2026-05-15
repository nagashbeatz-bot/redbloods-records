import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/projects/migrate
 * One-time migration: copies all Monday.com projects to Supabase projects table.
 * Safe to run multiple times — uses monday_id UNIQUE constraint to skip duplicates.
 * Also updates sessions.project_id from Monday IDs to Supabase UUIDs.
 */
export async function POST() {
  try {
    const { fetchProjects } = await import("@/lib/monday");
    const mondayProjects = await fetchProjects();

    const imported: string[] = [];
    const skipped:  string[] = [];
    const failed:   { name: string; error: string }[] = [];

    for (const p of mondayProjects) {
      // Check if already migrated (by monday_id)
      const { data: existing } = await supabase
        .from("projects")
        .select("id")
        .eq("monday_id", p.id)
        .single();

      if (existing) {
        skipped.push(p.name);
        continue;
      }

      // Build files array (store name + assetId for future URL fetching)
      const files = p.files.map((f) => ({
        name:    f.name,
        assetId: f.assetId,
        url:     f.url !== "#" ? f.url : undefined,
      }));

      const { data: inserted, error } = await supabase
        .from("projects")
        .insert({
          monday_id:      p.id,
          name:           p.name,
          artist:         p.artist         || "",
          status:         p.status         || "לא התחיל",
          deadline:       p.deadline       || null,
          notes:          p.notes          || "",
          project_type:   p.projectType    || "",
          parent_project: p.parentProject  || "",
          files,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        failed.push({ name: p.name, error: error?.message || "insert failed" });
        continue;
      }

      imported.push(p.name);

      // Update any sessions that reference this Monday ID → new UUID
      await supabase
        .from("sessions")
        .update({ project_id: inserted.id })
        .eq("project_id", p.id);
    }

    console.log(`[migrate] imported=${imported.length} skipped=${skipped.length} failed=${failed.length}`);

    return NextResponse.json({ ok: true, imported, skipped, failed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[projects/migrate]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
