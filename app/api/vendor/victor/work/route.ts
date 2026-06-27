import { NextResponse } from "next/server";
import { requireVictorAccess, requireOwner } from "@/lib/require-auth";

/**
 * GET  /api/vendor/victor/work?projectId=...  — get work record for a project
 * POST /api/vendor/victor/work               — create a new work record (owner only)
 */

export async function GET(req: Request) {
  const denied = await requireVictorAccess(); if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ ok: false, error: "projectId חסר" }, { status: 400 });

    const { getVictorWorkForProject } = await import("@/lib/vendor-store");
    const work = await getVictorWorkForProject(projectId);
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json() as {
      projectId: string;
      status?: string;
      workState?: string;
      outcome?: string;
      sentDate?: string;
      notes?: string;
      dropboxFolder?: string;
      dropboxShareLink?: string;
    };
    if (!body.projectId) return NextResponse.json({ ok: false, error: "projectId חסר" }, { status: 400 });

    const { createVictorWork } = await import("@/lib/vendor-store");
    const work = await createVictorWork(body.projectId, {
      status:           (body.status    as import("@/lib/types").VictorStatus)    ?? "פעיל",
      workState:        (body.workState as import("@/lib/types").VictorWorkState) ?? "נשלח לויקטור",
      outcome:          (body.outcome   as import("@/lib/types").VictorOutcome)   ?? undefined,
      sentDate:         body.sentDate ?? new Date().toISOString().split("T")[0],
      notes:            body.notes ?? "",
      dropboxFolder:    body.dropboxFolder    ?? null,
      dropboxShareLink: body.dropboxShareLink ?? null,
    });
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
