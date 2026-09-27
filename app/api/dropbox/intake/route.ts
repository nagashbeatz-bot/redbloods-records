import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { runIntake } from "@/lib/writes/intake";


// ── POST /api/dropbox/intake — scan / move / diag / delete-source; the logic is the shared writer lib/writes/intake ──
export async function POST(req: NextRequest) {
  const denied = await requireOwner(); if (denied) return denied; // in-route Owner check (the central gate is the first layer)
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const r = await runIntake(body);
  return NextResponse.json(r.json, { status: r.status });
}
