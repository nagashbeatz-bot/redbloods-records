import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess, resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { getAvailability, saveAvailability } from "@/lib/red-artists/availability";
import { countValidDays } from "@/lib/shalev-availability-reminder-pure";

// GET /api/label/artists/[id]/availability — this artist's last saved weekly
// availability. Owner-only preview. NEVER sends push (page load must be
// side-effect free — same rule as the Shalev-only route).
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;
  try {
    const availability = await getAvailability(access.config.slug);
    return NextResponse.json({ ok: true, availability });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "server error" }, { status: 500 });
  }
}

// POST /api/label/artists/[id]/availability — save this artist's availability.
// Intentionally NEVER calls notifyAvailability — that push is Shalev-only by
// design (the "shalev" push role doesn't exist for any other artist yet), and
// this task explicitly adds no new push behavior.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const body = await req.json().catch(() => ({}));
    const days = (body as { days?: unknown }).days;
    if (!Array.isArray(days)) {
      return NextResponse.json({ ok: false, error: "days נדרש" }, { status: 400 });
    }
    // Same "≥2 different days" data-integrity rule as the Shalev-only route
    // (never trust client-side validation alone) — this is input validation,
    // not the reminder/push mechanism, which stays Shalev-only.
    const coerced = days.map((d) => {
      const o = (d ?? {}) as { available?: unknown; from?: unknown };
      const available = o.available === true;
      return { available, from: available && typeof o.from === "string" ? o.from : "" };
    });
    if (countValidDays(coerced) < 2) {
      return NextResponse.json({ ok: false, error: "יש לבחור לפחות שני ימי זמינות שונים לשבוע הבא" }, { status: 400 });
    }
    const availability = await saveAvailability(access.config.slug, days, "owner");
    // Same sentinel the client already treats as "not a real failure" (mirrors
    // pushAllowed()'s non-production skip) — push is simply not wired up for
    // this artist yet, not an attempted-and-failed send.
    return NextResponse.json({ ok: true, availability, push: { sent: false, error: "push-disabled-non-production" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "server error" }, { status: 500 });
  }
}
