/**
 * GET  /api/agent/alerts?status=new&limit=50&sinceHours=168
 * POST /api/agent/alerts — create manual alert
 */
import { NextRequest, NextResponse } from "next/server";
import { getAlerts, createAlertIfNotCoolingDown, getUnreadCount } from "@/lib/agent/alerts-store";
import { requireOwner } from "@/lib/require-auth";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";
import type { AlertSeverity, AlertStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const params  = req.nextUrl.searchParams;
  const countOnlyEarly = params.get("count") === "1";
  // Kill-switch — return an empty result in the existing shape WITHOUT touching
  // the DB, so no stale alerts are ever exposed while the agent is disabled.
  if (!MAI_AI_ENABLED) return NextResponse.json(countOnlyEarly ? { count: 0 } : { alerts: [] });

  // Owner-only — agent alerts are the owner's and must not reach Victor.
  const denied = await requireOwner(); if (denied) return denied;
  const status  = params.get("status")  as AlertStatus | null;
  const countOnly = params.get("count") === "1";
  const limit   = parseInt(params.get("limit") ?? "50");
  const sinceH  = params.get("sinceHours") ? parseInt(params.get("sinceHours")!) : undefined;

  if (countOnly) {
    const count = await getUnreadCount();
    return NextResponse.json({ count });
  }

  const alerts = await getAlerts({
    status:     status ?? undefined,
    limit,
    sinceHours: sinceH,
  });
  return NextResponse.json({ alerts });
}

export async function POST(req: NextRequest) {
  // Kill-switch — no manual alert creation while the agent is disabled.
  if (!MAI_AI_ENABLED) return NextResponse.json({ disabled: true }, { status: 503 });
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await req.json();
    const alert = await createAlertIfNotCoolingDown({
      type:              body.type,
      severity:          (body.severity ?? "info") as AlertSeverity,
      title:             body.title,
      message:           body.message,
      relatedProjectId:  body.relatedProjectId ?? null,
      relatedClientId:   body.relatedClientId  ?? null,
      metadata:          body.metadata          ?? {},
      suggestedActions:  body.suggestedActions  ?? [],
      source:            "manual",
    });
    if (!alert) {
      return NextResponse.json({ skipped: true, reason: "cooldown" });
    }
    return NextResponse.json({ alert });
  } catch (e) {
    console.error("[agent/alerts] POST error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
