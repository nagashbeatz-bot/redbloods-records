import { NextRequest, NextResponse } from "next/server";
import { requireShalevAccess, getAuthRole } from "@/lib/require-auth";
import { getAvailability, saveAvailability, notifyAvailability, type Sender } from "@/lib/red-artists/availability";

// GET /api/red-artists/availability — the last saved weekly availability.
// Owner or shalev only. NEVER sends push (page load must be side-effect free).
export async function GET() {
  const denied = await requireShalevAccess(); if (denied) return denied;
  try {
    const availability = await getAvailability();
    return NextResponse.json({ ok: true, availability });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "server error" }, { status: 500 });
  }
}

// POST /api/red-artists/availability — save the availability + fire role-aware push.
// `sentBy` is derived SERVER-SIDE from the session role (never trusted from the
// client). A push failure does NOT fail the save — it's reported in `push`.
export async function POST(req: NextRequest) {
  const denied = await requireShalevAccess(); if (denied) return denied;
  const sentBy: Sender = (await getAuthRole()) === "shalev" ? "shalev" : "owner"; // guard ⇒ owner|shalev only
  try {
    const body = await req.json().catch(() => ({}));
    const days = (body as { days?: unknown }).days;
    if (!Array.isArray(days)) {
      return NextResponse.json({ ok: false, error: "days נדרש" }, { status: 400 });
    }
    const availability = await saveAvailability(days, sentBy);
    const push = await notifyAvailability(sentBy); // after a successful save; non-fatal
    return NextResponse.json({ ok: true, availability, push });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "server error" }, { status: 500 });
  }
}
