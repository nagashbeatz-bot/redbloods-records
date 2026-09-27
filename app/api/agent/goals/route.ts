/**
 * GET  /api/agent/goals — return current goals + progress
 * PATCH /api/agent/goals — update one or more goals
 * Body: { monthlyRevenue?: {...}, weeklySessions?: {...}, ... }
 */
import { NextRequest, NextResponse } from "next/server";
import { getGoals, getGoalsProgress } from "@/lib/agent/goals";
import { setBusinessGoal, SystemInputError, validGoal } from "@/lib/writes/system";
import type { BusinessGoals } from "@/lib/types";

export async function GET() {
  const now    = new Date();
  const month  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [goals, progress] = await Promise.all([
    getGoals(),
    getGoalsProgress(month),
  ]);
  return NextResponse.json({ goals, progress });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<BusinessGoals>;
    const keys = Object.keys(body) as Array<keyof BusinessGoals>;
    // shared writer (lib/writes/system): only the four known goals, validated — all checked before any write
    for (const key of keys) if (body[key] !== undefined) validGoal(key, body[key]);
    for (const key of keys) if (body[key] !== undefined) await setBusinessGoal(key, body[key]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SystemInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[agent/goals] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
