import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, createCampaign } from "@/lib/social-store";

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
    const campaign = await createCampaign(body);
    return NextResponse.json({ campaign });
  } catch (e: unknown) {
    // PostgreSQL unique violation (23505) = duplicate project_id
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("23505") || msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "duplicate_project" }, { status: 409 });
    }
    console.error("[social/campaigns] POST error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
