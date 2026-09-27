import { NextRequest, NextResponse } from "next/server";
import { convertProposal } from "@/lib/writes/proposals";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/proposals/[id]/convert
 * Creates a real project from a proposal and marks it as "נסגר"; saves the agreed price when amount > 0; closes the
 * follow-up task. Shared writer (lib/writes/proposals) — hardened with a compare-and-swap claim (no double project).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({})) as { projectName?: string };
    const overrideName: string | undefined = body.projectName?.trim() || undefined;

    const r = await convertProposal(id, overrideName);
    if (r.status === "not_found") return NextResponse.json({ error: "הצעה לא נמצאה" }, { status: 404 });
    if (r.status === "already_converted") return NextResponse.json({ error: "already_converted", projectId: r.projectId }, { status: 409 });
    if (r.status === "busy") return NextResponse.json({ error: "already_converted" }, { status: 409 });
    const project = r.project;

    return NextResponse.json({
      ok: true,
      projectId: project.id,
      project: {
        id:           project.id,
        name:         project.name,
        artist:       project.artist,
        status:       project.status,
        deadline:     project.deadline  ?? null,
        project_type: (project.projectType as string) ?? "",
        isOverdue:    false,
        isDueSoon:    false,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[proposals convert]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
