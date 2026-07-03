import { NextResponse } from "next/server";
import { getMaintenance } from "@/lib/maintenance";

/**
 * GET /api/maintenance/status  → { enabled: boolean }
 *
 * PUBLIC on purpose: it exposes ONLY the boolean lock state (no system data),
 * so the proxy can read it via a cached self-fetch and the owner Sidebar can
 * render the lock. Listed in the proxy's PUBLIC_BYPASS. Fail-open on error.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ enabled: await getMaintenance() });
  } catch (e) {
    console.error("[maintenance/status] read failed (fail-open):", e);
    return NextResponse.json({ enabled: false });
  }
}
