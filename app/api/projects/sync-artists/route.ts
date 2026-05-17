import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { upsertArtistsFromProject } from "@/lib/clients-store";

/**
 * GET /api/projects/sync-artists
 *
 * One-shot backfill: reads every project's artist field and upserts
 * all missing artists into the clients table (type = "אמן").
 */
export async function GET() {
  try {
    // Fetch all project artist strings
    const { data: projects, error } = await supabase
      .from("projects")
      .select("artist")
      .neq("artist", "");

    if (error) throw new Error(error.message);

    const rawArtists = (projects ?? [])
      .map((p: { artist: string }) => p.artist)
      .filter(Boolean);

    // Collect all unique individual names across every project
    const allNames = Array.from(
      new Set(
        rawArtists.flatMap((raw: string) =>
          raw.split(/[,،;]/).map((s: string) => s.trim()).filter(Boolean)
        )
      )
    );

    if (allNames.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: "אין אמנים לסנכרן" });
    }

    // Which names already exist?
    const { data: existing } = await supabase
      .from("clients")
      .select("name")
      .in("name", allNames);

    const existingSet = new Set((existing ?? []).map((c: { name: string }) => c.name));
    const toCreate = allNames.filter((n) => !existingSet.has(n));

    if (toCreate.length > 0) {
      const { error: insErr } = await supabase.from("clients").insert(
        toCreate.map((name) => ({
          name,
          phone:  "",
          email:  "",
          type:   "אמן",
          status: "חדש",
          notes:  "",
        }))
      );
      if (insErr) throw new Error(insErr.message);
    }

    return NextResponse.json({
      ok:      true,
      total:   allNames.length,
      existed: existingSet.size,
      synced:  toCreate.length,
      names:   toCreate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sync-artists]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
