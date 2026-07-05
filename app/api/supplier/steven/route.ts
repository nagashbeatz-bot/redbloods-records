import { NextResponse } from "next/server";
import { requireStevenAccess } from "@/lib/require-auth";
import { listSoundEngineerWork } from "@/lib/sound-engineer-store";
import { STEVEN_ENGINEER, sanitizeWorkForSteven } from "@/lib/steven-scope";

/**
 * GET /api/supplier/steven — Steven's own works only, financials stripped.
 * Hard-scoped server-side to engineerName='Steven' (never a client value), then
 * sanitized. Read-only: there is no POST/DELETE here (create/delete are owner-only).
 */
export async function GET() {
  const denied = await requireStevenAccess(); if (denied) return denied;
  try {
    const works = (await listSoundEngineerWork(STEVEN_ENGINEER)).map(sanitizeWorkForSteven);
    return NextResponse.json({ ok: true, works });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
