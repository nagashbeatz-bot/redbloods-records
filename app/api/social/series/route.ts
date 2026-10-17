import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { createSocialSeries, listSocialSeries, SocialInputError } from "@/lib/writes/social";

/** Social stage 2 — content series (Owner-only in the route). GET list · POST create. No delete (a series is ended, never removed). */
export async function GET() {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try { return NextResponse.json({ series: await listSocialSeries() }); }
  catch (e) { console.error("[social/series] GET", e); return NextResponse.json({ error: "failed" }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try { return NextResponse.json({ series: await createSocialSeries(await req.json()) }); }
  catch (e) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social/series] POST", e); return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
