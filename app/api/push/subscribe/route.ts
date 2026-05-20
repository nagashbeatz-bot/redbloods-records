import { NextRequest, NextResponse } from "next/server";
import { saveSubscription } from "@/lib/push";

export async function POST(req: NextRequest) {
  try {
    const sub = await req.json();
    await saveSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("push subscribe error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
