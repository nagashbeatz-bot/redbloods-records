import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createProposal } from "@/lib/writes/proposals";
import { requireOwner } from "@/lib/require-auth";

// GET /api/proposals?clientId=xxx
export async function GET(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId) return NextResponse.json({ error: "clientId חסר" }, { status: 400 });

    const { data, error } = await supabase
      .from("proposals")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ proposals: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/proposals — create proposal
export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const body = await req.json();
    const { clientId, title, amount, currency, status, sentDate, followupDate, notes } = body;

    if (!clientId) return NextResponse.json({ error: "clientId חסר" }, { status: 400 });
    if (!title?.trim()) return NextResponse.json({ error: "כותרת חובה" }, { status: 400 });

    // Shared writer (lib/writes/proposals) — the same one Sunny's CREATE_PROPOSAL primitive uses.
    const data = await createProposal({ clientId, title, amount, currency, status, sentDate, followupDate, notes });
    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
