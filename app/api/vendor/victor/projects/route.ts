import { NextResponse } from "next/server";
import { requireVictorAccess, getAuthRole } from "@/lib/require-auth";

/**
 * GET /api/vendor/victor/projects — scoped: ONLY the projects Victor is assigned
 * to (i.e. that have a vendor_project_work row with vendor_name="victor").
 * Replaces any use of the full /api/projects list for the Victor page so a
 * supplier never sees the whole project roster. Owner may also call it.
 */
export async function GET() {
  const denied = await requireVictorAccess();
  if (denied) return denied;

  try {
    const { getVictorWork, sanitizeWorkForVictor } = await import("@/lib/vendor-store");
    const raw = await getVictorWork(); // all victor work, enriched with project info
    // For Victor, sanitized rows have projectId=null → they drop out of the map
    // below, so a supplier gets NO project roster (name/artist) at all.
    const work = (await getAuthRole()) === "victor" ? raw.map(sanitizeWorkForVictor) : raw;

    const byProject = new Map<string, { id: string; name: string; artist: string; workStatus: string; workState: string | null }>();
    for (const w of work) {
      if (!w.projectId || byProject.has(w.projectId)) continue;
      byProject.set(w.projectId, {
        id:         w.projectId,
        name:       w.projectName,
        artist:     w.artist,
        workStatus: w.status,
        workState:  w.workState,
      });
    }

    return NextResponse.json({ ok: true, projects: [...byProject.values()] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
