import { NextRequest, NextResponse } from "next/server";
import { getCampaign, updateCampaign, deleteCampaign } from "@/lib/social-store";

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
    const campaign = await updateCampaign(id, body);
    return NextResponse.json({ campaign });
  } catch (e) {
    console.error("[social/campaigns/id] PATCH error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[social/campaigns/id] DELETE error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
