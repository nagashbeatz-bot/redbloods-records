/**
 * GET  /api/agent/goals — return current goals + progress
 * PATCH /api/agent/goals — update one or more goals
 * Body: { monthlyRevenue?: {...}, weeklySessions?: {...}, ... }
 */
import { NextRequest, NextResponse } from "next/server";
import { getGoals, updateGoal, getGoalsProgress } from "@/lib/agent/goals";
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
    for (const key of keys) {
      if (body[key] !== undefined) {
        await updateGoal(key, body[key]!);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[agent/goals] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
