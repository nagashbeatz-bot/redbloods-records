import { NextRequest, NextResponse } from "next/server";
import { getCampaign } from "@/lib/social-store";
import { deleteSocialCampaign, SocialInputError, updateSocialCampaign } from "@/lib/writes/social";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ campaign });
  } catch (e) {
    console.error("[social/campaigns/id] GET error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const campaign = await updateSocialCampaign(id, body); // shared writer — validated fields only
    return NextResponse.json({ campaign });
  } catch (e) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social/campaigns/id] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteSocialCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[social/campaigns/id] DELETE error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
