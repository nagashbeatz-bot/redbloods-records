import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/proposals?clientId=xxx
export async function GET(req: NextRequest) {
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
  try {
    const body = await req.json();
    const { clientId, title, amount, currency, status, sentDate, followupDate, notes } = body;

    if (!clientId) return NextResponse.json({ error: "clientId חסר" }, { status: 400 });
    if (!title?.trim()) return NextResponse.json({ error: "כותרת חובה" }, { status: 400 });

    const { data, error } = await supabase
      .from("proposals")
      .insert({
        client_id:     clientId,
        title:         title.trim(),
        amount:        Number(amount) || 0,
        currency:      currency || "₪",
        status:        status || "ממתין לתשובה",
        sent_date:     sentDate || null,
        followup_date: followupDate || null,
        notes:         notes?.trim() || "",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
