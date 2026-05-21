/**
 * PATCH /api/agent/alerts/[id] — update alert status
 * Body: { status: "handled" | "dismissed" | "ignored" }
 */
import { NextRequest, NextResponse } from "next/server";
import { updateAlertStatus } from "@/lib/agent/alerts-store";
import type { AlertStatus } from "@/lib/types";

const VALID_STATUSES: AlertStatus[] = ["new", "handled", "dismissed", "ignored"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body   = await req.json();
    const status = body.status as AlertStatus;
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    await updateAlertStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[agent/alerts/:id] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
