import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── GET /api/sessions?projectId=xxx ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    }

    // Fetch sessions
    const { data: rows, error: sessErr } = await supabase
      .from("sessions")
      .select("*")
      .eq("project_id", projectId)
      .order("date", { ascending: true });

    if (sessErr) throw new Error(sessErr.message);

    // Fetch session limit from settings table
    const { data: limitRow } = await supabase
      .from("settings")
      .select("value")
      .eq("key", `session_limit_${projectId}`)
      .single();

    const limit: number = (limitRow?.value as { limit?: number })?.limit ?? 3;

    return NextResponse.json({ sessions: rows ?? [], limit });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST /api/sessions — create new session ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, date, startTime, endTime, status, notes } = body;

    if (!projectId) {
      return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        project_id: projectId,
        date:       date       || null,
        start_time: startTime  || null,
        end_time:   endTime    || null,
        status:     status     || "מתוכנן",
        notes:      notes      || "",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ session: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH /api/sessions?projectId=xxx&type=limit — update session limit ──────
export async function PATCH(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const type      = req.nextUrl.searchParams.get("type");

    if (type === "limit") {
      if (!projectId) {
        return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
      }
      const { limit } = await req.json();
      const { error } = await supabase.from("settings").upsert({
        key:        `session_limit_${projectId}`,
        value:      { limit: Number(limit) },
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, limit: Number(limit) });
    }

    return NextResponse.json({ error: "סוג פעולה לא ידוע" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[sessions PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
