import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listLabelReleases, createReleaseForExisting, isValidStage } from "@/lib/release-store";

// GET /api/label/releases — all label projects joined with their release details.
export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const releases = await listLabelReleases();
    return NextResponse.json(releases);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/releases GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/label/releases — create release details for an EXISTING project only.
// Server enforces the project is a שיר + לייבל release.
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const { projectId, releaseStage, releaseTargetDate, nextAction, blocker, responsible } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "מזהה פרויקט חסר" }, { status: 400 });
    }
    if (releaseStage !== undefined && !isValidStage(releaseStage)) {
      return NextResponse.json({ error: "שלב ריליס לא חוקי" }, { status: 400 });
    }

    const result = await createReleaseForExisting(projectId, {
      releaseStage, releaseTargetDate, nextAction, blocker, responsible,
    });

    switch (result.status) {
      case "not_found":      return NextResponse.json({ error: "הפרויקט לא נמצא" }, { status: 404 });
      case "not_label_song": return NextResponse.json({ error: "ניתן להגדיר ריליס רק לפרויקט מסוג שיר המסומן כלייבל" }, { status: 409 });
      case "exists":         return NextResponse.json({ error: "כבר קיימים פרטי ריליס לפרויקט זה" }, { status: 409 });
      case "ok":             return NextResponse.json({ ok: true, release: result.release });
      default:               return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/releases POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
