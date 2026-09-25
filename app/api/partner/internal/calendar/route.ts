import { NextRequest, NextResponse } from "next/server";
import { handleInternalCalendar } from "@/lib/partner/calendar/internal-handler";

/**
 * GET /api/partner/internal/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Sunny connector → Redbloods MAIN: the Owner's live Google Calendar as SANITIZED data (lib/partner/calendar).
 * Service-to-service authenticated (dedicated secret header, constant-time check) — no cookie, no Owner session.
 * Read-only against Google; the only possible persisted side effect is the existing integration's normal OAuth token
 * refresh. Never returns credentials. Answers 404 on the MCP-only connector itself.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await handleInternalCalendar(
    { header: (n) => req.headers.get(n), query: (n) => req.nextUrl.searchParams.get(n) },
    process.env,
    async () => (await import("@/lib/partner/calendar/google-api")).googleCalendarApi(),
  );
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
}
