import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerPortalAccess, resolvePortalReadAccess } from "@/lib/red-artists/portal-access";
import { getNextWorkConfig, setNextWorkConfig } from "@/lib/red-artists/sketches-store";
import { errResponse } from "@/lib/red-artists/sketches-http";

// GET /api/label/artists/[id]/next-work → { work } (null when unset).
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolvePortalReadAccess(id);
  if (!access.ok) return access.response;
  try {
    const work = await getNextWorkConfig(access.config.slug);
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    return errResponse(err);
  }
}

// POST /api/label/artists/[id]/next-work — set it. body: { sketchId, deadline?: string|null }.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await resolveOwnerPortalAccess(id);
  if (!access.ok) return access.response;
  try {
    const body = await req.json().catch(() => ({}));
    const deadlineRaw = body?.deadline;
    const deadline = typeof deadlineRaw === "string" && deadlineRaw.trim() ? deadlineRaw.trim() : null;
    const work = await setNextWorkConfig(access.config.slug, String(body?.sketchId ?? ""), deadline);
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    return errResponse(err);
  }
}
