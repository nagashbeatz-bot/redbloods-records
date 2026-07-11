import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { setProjectBusinessType } from "@/lib/release-store";
import { PROJECT_BUSINESS_TYPES } from "@/lib/types";

// PATCH /api/label/projects/[id]/business-type — mark a project לקוח / לייבל.
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await req.json();
    const { businessType } = body;

    if (!PROJECT_BUSINESS_TYPES.includes(businessType)) {
      return NextResponse.json({ error: "ערך לקוח/לייבל לא חוקי" }, { status: 400 });
    }

    const ok = await setProjectBusinessType(id, businessType);
    if (!ok) return NextResponse.json({ error: "הפרויקט לא נמצא" }, { status: 404 });
    return NextResponse.json({ ok: true, businessType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[label/projects/[id]/business-type PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
