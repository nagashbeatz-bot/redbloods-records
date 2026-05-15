import { NextRequest, NextResponse } from "next/server";

// GET /api/monday/debug — shows board columns with types (for diagnostics)
// GET /api/monday/debug?artists=1 — shows all project artist values (for sync debugging)
export async function GET(req: NextRequest) {
  if (!process.env.MONDAY_API_TOKEN) {
    return NextResponse.json({ error: "No Monday token" }, { status: 400 });
  }
  try {
    const showArtists = new URL(req.url).searchParams.get("artists") === "1";

    if (showArtists) {
      const { fetchProjects } = await import("@/lib/monday");
      const projects = await fetchProjects();
      const artists = projects.map((p) => ({
        id: p.id,
        name: p.name,
        artist: p.artist,
        artistParts: p.artist ? p.artist.split(/[,،;]/).map((a) => `"${a.trim()}"`) : [],
      }));
      return NextResponse.json({ count: projects.length, artists });
    }

    const { debugColumnMap } = await import("@/lib/monday");
    const result = await debugColumnMap();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
