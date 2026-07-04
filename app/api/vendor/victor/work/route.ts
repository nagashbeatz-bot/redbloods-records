import { NextResponse } from "next/server";
import { requireVictorAccess, requireOwner, getAuthRole } from "@/lib/require-auth";

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

    const { getVictorWorkForProject, sanitizeWorkForVictor } = await import("@/lib/vendor-store");
    const work = await getVictorWorkForProject(projectId);
    const safe = work && (await getAuthRole()) === "victor" ? sanitizeWorkForVictor(work) : work;
    return NextResponse.json({ ok: true, work: safe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json() as {
      projectId?: string;
      title?: string;
      status?: string;
      workState?: string;
      outcome?: string;
      sentDate?: string;
      notes?: string;
      dropboxFolder?: string;
      dropboxShareLink?: string;
    };

    const projectId = body.projectId?.trim() || null;
    const title     = body.title?.trim() || null;
    // Either a real project (the "שלח לויקטור" flow) OR a Victor-only work title.
    // NEVER creates a row in `projects` — this only writes vendor_project_work.
    if (!projectId && !title) {
      return NextResponse.json({ ok: false, error: "צריך projectId או title" }, { status: 400 });
    }

    const { createVictorWork } = await import("@/lib/vendor-store");
    const work = await createVictorWork(projectId, {
      title:            title ?? undefined,
      status:           (body.status    as import("@/lib/types").VictorStatus)    ?? "פעיל",
      // Project-only "send to Victor" defaults to "נשלח לויקטור"; standalone work has no send-state.
      workState:        projectId ? ((body.workState as import("@/lib/types").VictorWorkState) ?? "נשלח לויקטור") : ((body.workState as import("@/lib/types").VictorWorkState) ?? undefined),
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
