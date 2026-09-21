import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";

/**
 * GET /api/calendar/auth-check — { state, needsReauth }
 *
 * Light credentials check for the app-wide reconnect gate. NOT a calendar sync:
 * it only tries to obtain an access token from the stored refresh token.
 * Always 200 for owners. The client blocks on the two definitive states:
 * "needs_reauth" (needsReauth=true — Google rejected the grant with invalid_grant,
 * or there is no refresh token) and "not_connected" (no token row). Anything
 * transient reports state "unknown" with needsReauth=false and never blocks.
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
