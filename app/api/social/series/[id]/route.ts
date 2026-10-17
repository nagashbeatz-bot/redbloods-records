import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { SocialInputError, updateSocialSeries } from "@/lib/writes/social";

/** Social stage 2 — edit a series' allowed fields (name / platforms / status / notes). Owner-only in the route. No DELETE. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  const { id } = await params;
  try { return NextResponse.json({ series: await updateSocialSeries(id, await req.json()) }); }
  catch (e) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social/series/id] PATCH", e); return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
