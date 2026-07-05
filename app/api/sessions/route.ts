import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { touchProject, ensureProjectStartDate } from "@/lib/projects-store";

// ── GET /api/sessions?projectId=xxx  OR  ?all=1 ──────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const all       = req.nextUrl.searchParams.get("all");
    const projectId = req.nextUrl.searchParams.get("projectId");

    // Return all sessions across all projects (for Insights page)
    if (all === "1") {
      const { data: rows, error: sessErr } = await supabase
        .from("sessions")
        .select("*")
        .order("date", { ascending: false });
      if (sessErr) throw new Error(sessErr.message);

      // Fetch all session limits
      const { data: limitRows } = await supabase
        .from("settings")
        .select("key, value")
        .like("key", "session_limit_%");

      const limits: Record<string, number> = {};
      (limitRows ?? []).forEach((r) => {
        const pid = (r.key as string).replace("session_limit_", "");
        limits[pid] = (r.value as { limit?: number })?.limit ?? 3;
      });

      return NextResponse.json({ sessions: rows ?? [], limits });
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId חסר" }, { status: 400 });
    }

    // Fetch sessions for one project
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
    const { projectId, title, date, startTime, endTime, status, sessionType, notes, calendarEventId, addToCalendar, photographer, location } = body;
    const cleanTitle = typeof title === "string" ? title.trim() : "";

    // A session must be tied to a project OR carry a manual title (independent
    // session). Never create a project here.
    if (!projectId && !cleanTitle) {
      return NextResponse.json({ error: "בחר פרויקט או הזן שם לסשן" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        project_id:        projectId ?? null,
        title:             cleanTitle || null,
        date:              date              || null,
        start_time:        startTime         || null,
        end_time:          endTime           || null,
        status:            status            || "מתוכנן",
        session_type:      sessionType       || "סשן",
        notes:             notes             || "",
        calendar_event_id: calendarEventId   || null,
        photographer:      photographer      || "",
        location:          location          || "",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Optionally create Google Calendar event
    let calendarError: string | null = null;
    if (addToCalendar && date && startTime) {
      try {
        const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
        if (await isConnected()) {
          const calStart = `${date}T${startTime}:00`;
          // Compute end in Israel local time — same approach as meetings to avoid timezone confusion
          let calEnd: string;
          if (endTime) {
            calEnd = `${date}T${endTime}:00`;
          } else {
            const [hh, mm] = startTime.split(":").map(Number);
            const endTotalMin = hh * 60 + mm + 60; // default +1 hour
            const eHh = String(Math.floor(endTotalMin / 60) % 24).padStart(2, "0");
            const eMm = String(endTotalMin % 60).padStart(2, "0");
            calEnd = `${date}T${eHh}:${eMm}:00`;
          }
          const isFilming = sessionType === "צילום קליפ";
          let summary: string;
          if (projectId) {
            const { data: proj } = await supabase.from("projects").select("name, artist").eq("id", projectId).single();
            summary = proj
              ? isFilming
                ? `צילום קליפ: ${proj.name}${proj.artist ? ` — ${proj.artist}` : ""}${photographer ? ` (${photographer})` : ""}`
                : `סשן: ${proj.name}${proj.artist ? ` — ${proj.artist}` : ""}`
              : isFilming ? "צילום קליפ" : "סשן";
          } else {
            // Independent session — the manual title IS the calendar event name.
            summary = cleanTitle || (isFilming ? "צילום קליפ" : "סשן");
          }
          // Rehearsal-for-a-show gets a clear, dedicated calendar title. Additive:
          // existing session types keep their titles untouched.
          if (sessionType === "חזרה להופעה" && cleanTitle) {
            summary = `חזרה להופעה - ${cleanTitle}`;
          }
          const event = await createCalendarEvent(summary, calStart, calEnd, notes ? { description: notes } : undefined);
          const calId  = (event as { id?: string }).id ?? null;
          if (calId) {
            await supabase.from("sessions").update({ calendar_event_id: calId }).eq("id", data.id);
          }
        } else {
          calendarError = "Google Calendar לא מחובר";
        }
      } catch (err) {
        calendarError = err instanceof Error ? err.message : "שגיאה ביצירת אירוע ביומן";
      }
    }

    // Project-only side effects — skipped for independent (project-less) sessions.
    if (projectId) {
      // Bump project's updated_at so it rises to top of "עודכן לאחרונה" sort
      touchProject(projectId).catch(() => {});
      // Auto-fill start_date from earliest session if not yet set
      ensureProjectStartDate(projectId).catch(() => {});
    }

    return NextResponse.json({ session: data, calendarError });
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
