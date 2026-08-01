import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listPromotions, createPromotion, syncActualExpense, getCampaignPromotionBudget } from "@/lib/social-promotions-store";

// GET /api/social/promotions?campaignId=xxx → promotions (+ derived actual_amount)
export async function GET(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  try {
    const [promotions, promotion_budget] = await Promise.all([
      listPromotions(campaignId),
      getCampaignPromotionBudget(campaignId),
    ]);
    return NextResponse.json({ promotions, promotion_budget });
  } catch (e) {
    console.error("[social/promotions] GET error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

// POST /api/social/promotions → create a promotion (+ optional initial actual spend)
export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const body = await req.json();
    const campaignId = body.campaignId ?? body.campaign_id;
    if (!campaignId || !String(body.name ?? "").trim()) {
      return NextResponse.json({ error: "campaignId and name required" }, { status: 400 });
    }
    const promo = await createPromotion({
      campaign_id:    campaignId,
      channel:        body.channel    || "אחר",
      promo_type:     body.promo_type || "קידום ממומן",
      name:           String(body.name).trim(),
      planned_amount: Math.max(0, Number(body.planned_amount) || 0),
      status:         body.status     || "מתוכנן",
      promo_date:     body.promo_date  || null,
      notes:          body.notes       || "",
    });
    // Only materialise a transaction if a real spend was entered.
    const actual = Math.max(0, Number(body.actual) || 0);
    if (actual > 0) await syncActualExpense(promo.id, actual);
    return NextResponse.json({ ok: true, id: promo.id });
  } catch (e) {
    console.error("[social/promotions] POST error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
