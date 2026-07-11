import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listLabelReleases, convertProjectToLabelRelease, isValidStage } from "@/lib/release-store";

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

// POST /api/label/releases — convert an EXISTING song project into a label release
// linked to a chosen label artist (marks it לייבל + creates release details).
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const { projectId, labelArtistId, releaseStage, releaseTargetDate, nextAction, blocker, responsible } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "מזהה פרויקט חסר" }, { status: 400 });
    }
    if (!labelArtistId || typeof labelArtistId !== "string") {
      return NextResponse.json({ error: "יש לבחור אמן לייבל" }, { status: 400 });
    }
    if (releaseStage !== undefined && !isValidStage(releaseStage)) {
      return NextResponse.json({ error: "שלב ריליס לא חוקי" }, { status: 400 });
    }

    const result = await convertProjectToLabelRelease(projectId, labelArtistId, {
      releaseStage, releaseTargetDate, nextAction, blocker, responsible,
    });

    switch (result.status) {
      case "not_found":        return NextResponse.json({ error: "הפרויקט לא נמצא" }, { status: 404 });
      case "not_song":         return NextResponse.json({ error: "ניתן לסמן כלייבל רק פרויקט מסוג שיר" }, { status: 409 });
      case "artist_not_found": return NextResponse.json({ error: "אמן לייבל לא נמצא" }, { status: 404 });
      case "exists":           return NextResponse.json({ error: "כבר קיימים פרטי ריליס לפרויקט זה" }, { status: 409 });
      case "ok":               return NextResponse.json({ ok: true, release: result.release });
      default:                 return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/releases POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
