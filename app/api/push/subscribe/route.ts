import { NextRequest, NextResponse } from "next/server";
import { saveSubscription } from "@/lib/push";
import { requireOwner, getAuthUser } from "@/lib/require-auth";

export async function POST(req: NextRequest) {
  // Owner-only — never persist a Victor (or unknown) device as a push target.
  const denied = await requireOwner(); if (denied) return denied;
  // Bind the device to the authenticated user — never proceed unidentified.
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sub = await req.json();
    await saveSubscription(sub, "owner", user.id); // owner-gated + user-bound
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("push subscribe error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
