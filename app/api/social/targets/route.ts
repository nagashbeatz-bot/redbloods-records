import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { listSocialTargets, setSocialCadenceTarget, SocialInputError } from "@/lib/writes/social";

/**
 * Social stage 2 — weekly targets (Owner-only in the route). GET the full history · POST a new row (SET / replace / END).
 * Append-only: there is no PATCH / DELETE — a change is a new row that supersedes (the DB refuses edits and overlaps).
 */
export async function GET() {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try { return NextResponse.json({ targets: await listSocialTargets() }); }
  catch (e) { console.error("[social/targets] GET", e); return NextResponse.json({ error: "failed" }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try { return NextResponse.json({ target: await setSocialCadenceTarget(await req.json()) }); }
  catch (e) {
    if (e instanceof SocialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social/targets] POST", e); return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
