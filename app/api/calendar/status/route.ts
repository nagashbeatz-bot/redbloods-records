import { NextResponse } from "next/server";

/** GET /api/calendar/status — { connected: boolean } */
export async function GET() {
  const { isConnected } = await import("@/lib/google-calendar");
  return NextResponse.json({ connected: isConnected() });
}

/** DELETE /api/calendar/status — disconnect (revoke saved token) */
export async function DELETE() {
  const { revokeToken } = await import("@/lib/google-calendar");
  revokeToken();
  return NextResponse.json({ ok: true });
}
