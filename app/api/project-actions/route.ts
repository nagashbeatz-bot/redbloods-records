import { NextRequest, NextResponse } from "next/server";
import { createSendLogEntry } from "@/lib/writes/worklog";
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
    if (!body.projectId)  return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    if (!body.actionType) return NextResponse.json({ error: "actionType חסר" }, { status: 400 });
    const data = await createSendLogEntry(body); // shared writer (lib/writes/worklog)
    return NextResponse.json({ action: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
