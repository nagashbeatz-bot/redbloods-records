import { NextRequest, NextResponse } from "next/server";
import { listContentItems } from "@/lib/social-store";
import { createSocialContent, listSocialContentForArtist, listSocialContentWithoutCampaign, SocialInputError } from "@/lib/writes/social";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    // stage 1: one artist's content (with or without a campaign) / content that has no campaign (the hub board + counts)
    const artistId = sp.get("labelArtistId");
    if (artistId) {
      if (!UUID.test(artistId)) return NextResponse.json({ error: "labelArtistId invalid" }, { status: 400 });
      return NextResponse.json({ items: await listSocialContentForArtist(artistId) });
    }
    if (sp.get("scope") === "no-campaign") return NextResponse.json({ items: await listSocialContentWithoutCampaign() });
    const campaignId = sp.get("campaignId");
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
