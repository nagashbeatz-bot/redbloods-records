import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * GET /api/calendar/auth-check — { state, needsReauth }
 *
 * Light credentials check for the app-wide reconnect gate. NOT a calendar sync:
 * it only tries to obtain an access token from the stored refresh token.
 * Always 200 for owners; `needsReauth` is true ONLY when Google definitively
 * rejected the grant (invalid_grant) or there is no refresh token. Anything
 * transient reports state "unknown" with needsReauth=false.
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const { checkCalendarAuth } = await import("@/lib/google-calendar");
  const result = await checkCalendarAuth();
  return NextResponse.json(
    {
      state: result.state,
      needsReauth: result.state === "needs_reauth",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
