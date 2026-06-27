import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createTask, patchTask } from "@/lib/tasks-store";
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

    // Create follow-up task + Google Task if followup_date is set
    if (data.followup_date) {
      try {
        const { data: clientData } = await supabase
          .from("clients")
          .select("name")
          .eq("id", clientId)
          .single();
        const clientName = clientData?.name ?? "";
        const amountStr = amount ? ` · ${currency || "₪"}${Number(amount).toLocaleString()}` : "";

        // Embed proposal_id in notes for reliable lookup on future PATCHes
        const taskNotes = `[proposal_id:${data.id}]\nהצעה: ${title.trim()}${amountStr}`;

        const task = await createTask({
          title:        `מעקב הצעת מחיר - ${clientName}`,
          related_type: "client",
          related_id:   clientId,
          due_date:     data.followup_date,
          notes:        taskNotes,
        });

        // Sync to Google Tasks — non-critical, proposal save never fails because of this
        try {
          const { isConnected, createGoogleTask } = await import("@/lib/google-calendar");
          if (await isConnected()) {
            const googleNotes = [
              "משימת מעקב להצעת מחיר מתוך Redbloods OS",
              `לקוח: ${clientName}`,
              `הצעה: ${title.trim()}`,
              amount ? `סכום: ${currency || "₪"}${Number(amount).toLocaleString()}` : "",
            ].filter(Boolean).join("\n");

            const gt = await createGoogleTask(
              `מעקב הצעת מחיר - ${clientName}`,
              data.followup_date,
              googleNotes,
            );
            await patchTask(task.id, { calendar_event_id: gt.id });
          }
        } catch { /* Google not connected or failed — non-critical */ }
      } catch { /* task creation is non-critical */ }
    }

    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
