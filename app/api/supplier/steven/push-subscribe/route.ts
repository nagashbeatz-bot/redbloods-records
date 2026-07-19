import { NextRequest, NextResponse } from "next/server";
import { requireStevenAccess, getAuthRole, getAuthUser } from "@/lib/require-auth";
import { saveSubscription } from "@/lib/push";

/**
 * POST /api/supplier/steven/push-subscribe — Steven registers his device for Web
 * Push. Scoped under /api/supplier/steven/* (already in Steven's proxy allowlist)
 * and gated by requireStevenAccess. Saves with role="steven" so these devices
 * receive ONLY Steven-facing notices and NEVER the owner-internal ones.
 *
 * Owner uses /api/push/subscribe (role="owner") — an owner session that reaches
 * this endpoint (e.g. viewing Steven's page) is rejected, so an owner device is
 * never mislabelled "steven". Not public; no owner subscriptions touched.
 */
export async function POST(req: NextRequest) {
  const denied = await requireStevenAccess(); if (denied) return denied; // 401/403 for non owner/steven
  // Only a real Steven session may create a "steven" device.
  if ((await getAuthRole()) !== "steven") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  // Bind the device to the authenticated user — never proceed unidentified.
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const sub = await req.json();
    await saveSubscription(sub, "steven", user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("steven push subscribe error:", e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
