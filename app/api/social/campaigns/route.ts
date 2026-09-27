import { NextRequest, NextResponse } from "next/server";
import { listCampaigns } from "@/lib/social-store";
import { createSocialCampaign, SocialInputError } from "@/lib/writes/social";

export async function GET() {
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns });
  } catch (e) {
    console.error("[social/campaigns] GET error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const campaign = await createSocialCampaign(body); // shared writer — validated fields only
    return NextResponse.json({ campaign });
  } catch (e: unknown) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    // PostgreSQL unique violation (23505) = duplicate project_id
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("23505") || msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "duplicate_project" }, { status: 409 });
    }
    console.error("[social/campaigns] POST error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
