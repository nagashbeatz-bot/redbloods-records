import { NextRequest, NextResponse } from "next/server";
import { saveSubscription } from "@/lib/push";
import { requireOwner } from "@/lib/require-auth";

export async function POST(req: NextRequest) {
  // Owner-only — never persist a Victor (or unknown) device as a push target.
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const sub = await req.json();
    await saveSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("push subscribe error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
