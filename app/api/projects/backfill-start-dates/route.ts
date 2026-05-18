import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/projects/backfill-start-dates
 * One-time (or recurring) job: for every project with no start_date,
 * find its earliest session and set start_date accordingly.
 */
export async function POST() {
  try {
    // 1. Find all projects with no start_date
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .is("start_date", null);

    if (projErr) throw new Error(projErr.message);
    if (!projects || projects.length === 0) {
      return NextResponse.json({ updated: 0, message: "כל הפרויקטים כבר מעודכנים" });
    }

    let updated = 0;
    const skipped: string[] = [];

    for (const proj of projects) {
      // 2. Find earliest session date for this project
      const { data: rows } = await supabase
        .from("sessions")
        .select("date")
        .eq("project_id", proj.id)
        .not("date", "is", null)
        .order("date", { ascending: true })
        .limit(1);

      const earliest = (rows?.[0]?.date) as string | undefined;
      if (!earliest) {
        skipped.push(proj.id);
        continue;
      }

      // 3. Update project
      await supabase
        .from("projects")
        .update({ start_date: earliest, updated_at: new Date().toISOString() })
        .eq("id", proj.id);

      updated++;
    }

    return NextResponse.json({
      updated,
      skipped: skipped.length,
      message: `עודכנו ${updated} פרויקטים, ${skipped.length} ללא סשנים`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
