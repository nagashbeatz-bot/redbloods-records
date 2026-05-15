import { NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/clients-store";

/**
 * POST /api/clients/import-from-monday
 * Fetches all unique artist names from Monday.com projects
 * and imports any that don't already exist as clients.
 */
export async function POST() {
  try {
    const { fetchProjects } = await import("@/lib/monday");

    // 1. Get all projects from Monday
    const projects = await fetchProjects();

    // 2. Collect all unique artist names
    const allArtistNames = new Set<string>();
    for (const p of projects) {
      if (!p.artist) continue;
      p.artist
        .split(/[,،;]/)
        .map((a) => a.trim())
        .filter(Boolean)
        .forEach((a) => allArtistNames.add(a));
    }

    // 3. Get existing clients to avoid duplicates
    const existing = await listClients();
    const existingNames = new Set(
      existing.map((c) => c.name.trim().toLowerCase())
    );

    // 4. Import missing artists as clients
    const toImport = [...allArtistNames].filter(
      (name) => !existingNames.has(name.toLowerCase())
    );

    const imported: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const name of toImport) {
      try {
        await createClient({
          name,
          phone:  "",
          email:  "",
          type:   "אמן",
          status: "חדש",
          notes:  "",
        });
        imported.push(name);
      } catch (err) {
        failed.push({
          name,
          error: err instanceof Error ? err.message : "שגיאה",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped: [...allArtistNames].filter((n) =>
        existingNames.has(n.toLowerCase())
      ),
      failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients import-from-monday]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
