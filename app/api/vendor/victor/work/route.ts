import { NextResponse } from "next/server";

/**
 * GET  /api/vendor/victor/work?projectId=...  — get work record for a project
 * POST /api/vendor/victor/work               — create a new work record
 */

export async function GET(req: Request) {
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
  try {
    const body = await req.json() as {
      projectId: string;
      status?: string;
      sentDate?: string;
      notes?: string;
      dropboxFolder?: string;
      dropboxShareLink?: string;
    };
    if (!body.projectId) return NextResponse.json({ ok: false, error: "projectId חסר" }, { status: 400 });

    const { createVictorWork } = await import("@/lib/vendor-store");
    const work = await createVictorWork(body.projectId, {
      status:           (body.status as import("@/lib/types").VictorStatus) ?? "נשלח לויקטור",
      sentDate:         body.sentDate ?? new Date().toISOString().split("T")[0],
      notes:            body.notes ?? "",
      dropboxFolder:    body.dropboxFolder ?? null,
      dropboxShareLink: body.dropboxShareLink ?? null,
    });
    return NextResponse.json({ ok: true, work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
