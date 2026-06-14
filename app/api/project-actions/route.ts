import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId חסר" }, { status: 400 });

    const { data, error } = await supabase
      .from("project_actions")
      .select("*")
      .eq("project_id", projectId)
      .order("action_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ actions: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId, actionType, contentType, versionLabel,
      recipientRole, recipientName, recipientClientId, recipientPhone,
      dropboxUrl, status, actionDate, followupDate, notes,
    } = body;

    if (!projectId)  return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    if (!actionType) return NextResponse.json({ error: "actionType חסר" }, { status: 400 });

    const { data, error } = await supabase
      .from("project_actions")
      .insert({
        project_id:          projectId,
        action_type:         actionType,
        content_type:        contentType        || null,
        version_label:       versionLabel       || null,
        recipient_role:      recipientRole      || null,
        recipient_name:      recipientName      || null,
        recipient_client_id: recipientClientId  || null,
        recipient_phone:     recipientPhone     || null,
        dropbox_url:         dropboxUrl         || null,
        status:              status             || "pending_feedback",
        action_date:         actionDate         || new Date().toISOString().slice(0, 10),
        followup_date:       followupDate       || null,
        notes:               notes              || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ action: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
