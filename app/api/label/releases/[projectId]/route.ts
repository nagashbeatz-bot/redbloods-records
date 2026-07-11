import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { getReleaseDetails, updateReleaseDetails, isValidStage } from "@/lib/release-store";

// GET /api/label/releases/[projectId] — one release row (or null).
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { projectId } = await context.params;
    const release = await getReleaseDetails(projectId);
    return NextResponse.json({ release });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/releases/[id] GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/label/releases/[projectId] — update release details.
// Optimistic lock: body MUST include expectedUpdatedAt; conflict → 409 (no retry).
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { projectId } = await context.params;
    const body = await req.json();
    const { expectedUpdatedAt, releaseStage, releaseTargetDate, nextAction, blocker, responsible } = body;

    // expectedUpdatedAt must exist and parse as a timestamp — validation only,
    // NOT a conflict decision (the DB UPDATE WHERE is the sole authority).
    if (typeof expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(expectedUpdatedAt))) {
      return NextResponse.json({ error: "חסר חותם עדכון תקין" }, { status: 400 });
    }
    if (releaseStage !== undefined && !isValidStage(releaseStage)) {
      return NextResponse.json({ error: "שלב ריליס לא חוקי" }, { status: 400 });
    }

    const result = await updateReleaseDetails(projectId, expectedUpdatedAt, {
      releaseStage, releaseTargetDate, nextAction, blocker, responsible,
    });

    switch (result.status) {
      case "not_found": return NextResponse.json({ error: "פרטי הריליס לא נמצאו" }, { status: 404 });
      case "conflict":  return NextResponse.json({ error: "פרטי הריליס עודכנו במקום אחר. יש לרענן ולנסות שוב." }, { status: 409 });
      case "ok":        return NextResponse.json({ ok: true, release: result.release });
      default:          return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/releases/[id] PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
