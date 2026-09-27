import { NextRequest, NextResponse } from "next/server";
import { listContentItems } from "@/lib/social-store";
import { createSocialContent, SocialInputError } from "@/lib/writes/social";

export async function GET(req: NextRequest) {
  try {
    const campaignId = req.nextUrl.searchParams.get("campaignId");
    if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
    const items = await listContentItems(campaignId);
    return NextResponse.json({ items });
  } catch (e) {
    console.error("[social/content] GET error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await createSocialContent(body); // shared writer — validated fields only
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social/content] POST error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
