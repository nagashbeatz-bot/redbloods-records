import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess } from "@/lib/red-artists/portal-access";
import { getOrCreatePressKitLink } from "@/lib/red-artists/portal-files";

// POST /api/label/artists/[id]/press-kit-link — Dropbox shared link for this
// artist's OWN press-kit folder (created idempotently on first use).
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const shareLink = await getOrCreatePressKitLink(access.config.slug);
    if (shareLink) return NextResponse.json({ ok: true, shareLink });
    return NextResponse.json({ ok: false, error: "לא ניתן לפתוח את התיקייה כרגע" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/artists/[id]/press-kit-link]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
