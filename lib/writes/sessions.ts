/**
 * Shared session writers — used by BOTH the session routes and Sunny's typed primitives.
 * createSession / deleteSession are the routes' exact behaviour (Google event, rehearsal finance sync, project touch +
 * start date, the Shalev push). HARDENED (2026-09-27, Universal Actions):
 *   • an edit of date / start / end now moves the linked Google event even when the caller did not send absolute
 *     times (the event used to stay on the old date — "a date-only edit leaves the calendar event on the old date");
 *   • an optional artist invite (attendees) is part of the SAME create, so the event and the session are one write.
 */
import { supabase } from "@/lib/supabase";
import { touchProject, ensureProjectStartDate } from "@/lib/projects-store";
import { notifySessionCreatedForShalev } from "@/lib/session-notify";
import { sessionEndLocal } from "@/lib/session-duration";

export const REHEARSAL_SESSION_TYPE = "חזרה להופעה";

/**
 * Local calendar start / end for a session (end ≤ start = next day; no end = +1 hour). The end is the ONE shared rule
 * `sessionEndLocal` (lib/session-duration.ts) — the same end the UI's "עבר — לא אושר" badge, the reports and the
 * calendar-pull use. Outputs are unchanged for normal sessions; a no-end session starting 23:00+ now ends the next day
 * (it used to produce an end before its start).
 */
export function sessionCalendarTimes(date: string, startTime: string, endTime?: string | null): { start: string; end: string } {
  const calStart = `${date}T${startTime}:00`;
  const end = sessionEndLocal(date, startTime, endTime ?? null);
  return { start: calStart, end: end ?? calStart };
}

export interface SessionInput {
  projectId?: string | null; title?: string | null; date?: string | null; startTime?: string | null; endTime?: string | null; status?: string | null;
  sessionType?: string | null; notes?: string | null; calendarEventId?: string | null; addToCalendar?: boolean; photographer?: string | null;
  location?: string | null; showId?: string | null; cost?: number | string | null; paymentStatus?: string | null;
  /** Sunny / invite flow: invite these guests on the created event (Google emails them) with a public title + description. */
  invite?: { emails: string[]; publicTitle: string; publicDescription?: string } | null;
}
export class SessionInputError extends Error {}

export async function createSession(b: SessionInput): Promise<{ session: Record<string, unknown>; calendarError: string | null }> {
  const { projectId, title, date, startTime, endTime, status, sessionType, notes, calendarEventId, addToCalendar, photographer, location, showId, cost, paymentStatus, invite } = b;
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!projectId && !cleanTitle) throw new SessionInputError("בחר פרויקט או הזן שם לסשן");
  const costNum = cost === "" || cost == null ? null : Number(cost);
  if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) throw new SessionInputError("עלות לא תקינה");
  if (sessionType === REHEARSAL_SESSION_TYPE && showId && costNum != null && costNum > 0) await refuseCollabRehearsalCost(showId);

  const { data, error } = await supabase.from("sessions").insert({
    project_id: projectId ?? null, title: cleanTitle || null, date: date || null, start_time: startTime || null, end_time: endTime || null,
    status: status || "מתוכנן", session_type: sessionType || "סשן", notes: notes || "", calendar_event_id: calendarEventId || null,
    photographer: photographer || "", location: location || "", show_id: showId || null, cost: costNum,
  }).select().single();
  if (error) throw new Error(error.message);

  let calendarError: string | null = null;
  if ((addToCalendar || invite) && date && startTime) {
    try {
      const { isConnected, createCalendarEvent } = await import("@/lib/google-calendar");
      if (await isConnected()) {
        const { start: calStart, end: calEnd } = sessionCalendarTimes(date, startTime, endTime);
        const isFilming = sessionType === "צילום קליפ";
        let summary: string;
        if (projectId) {
          const { data: proj } = await supabase.from("projects").select("name, artist").eq("id", projectId).single();
          summary = proj
            ? isFilming
              ? `צילום קליפ: ${proj.name}${proj.artist ? ` — ${proj.artist}` : ""}${photographer ? ` (${photographer})` : ""}`
              : `סשן: ${proj.name}${proj.artist ? ` — ${proj.artist}` : ""}`
            : isFilming ? "צילום קליפ" : "סשן";
        } else summary = cleanTitle || (isFilming ? "צילום קליפ" : "סשן");
        if (sessionType === REHEARSAL_SESSION_TYPE && cleanTitle) summary = `חזרה להופעה - ${cleanTitle}`;
        const event = invite?.emails.length
          ? await createCalendarEvent(invite.publicTitle, calStart, calEnd, { attendees: invite.emails.map((email) => ({ email })), description: invite.publicDescription })
          : await createCalendarEvent(summary, calStart, calEnd, notes ? { description: notes } : undefined);
        const calId = (event as { id?: string }).id ?? null;
        if (calId) {
          await supabase.from("sessions").update({ calendar_event_id: calId }).eq("id", data.id);
          (data as Record<string, unknown>).calendar_event_id = calId;
        }
      } else calendarError = "Google Calendar לא מחובר";
    } catch (err) {
      calendarError = err instanceof Error ? err.message : "שגיאה ביצירת אירוע ביומן";
    }
  }

  // Rehearsal → canonical Finance (idempotent) + re-derive the show's split (showId validated against a real show).
  if (sessionType === REHEARSAL_SESSION_TYPE && showId) {
    try {
      const { getShow } = await import("@/lib/shows-store");
      const show = await getShow(showId);
      if (show) {
        const { syncRehearsalFinance, syncShowFinance } = await import("@/lib/shows-finance-sync");
        await syncRehearsalFinance({ id: data.id, date: data.date, cost: data.cost }, show, paymentStatus === "שולם" ? "שולם" : "לא שולם");
        await syncShowFinance(show);
      }
    } catch (e) {
      console.error("[sessions] rehearsal finance sync error:", e);
    }
  }
  if (projectId) {
    touchProject(projectId).catch(() => {});
    ensureProjectStartDate(projectId).catch(() => {});
  }
  // Owner + Shalev push iff the session belongs to one of his projects (checked inside; production-only; best-effort).
  notifySessionCreatedForShalev({ id: data.id, projectId: data.project_id ?? null, date: data.date, startTime: data.start_time, endTime: data.end_time })
    .catch((e) => console.error("[sessions] shalev push error:", e));
  return { session: data as Record<string, unknown>, calendarError };
}

export interface SessionPatch {
  date?: string | null; startTime?: string | null; endTime?: string | null; status?: string; sessionType?: string; notes?: string; photographer?: string;
  location?: string; startIso?: string; endIso?: string; summary?: string; cost?: number | string | null; paymentStatus?: string;
}

/**
 * Who is writing. "CALENDAR_PULL" = the calendar → Redbloods pull (the event already moved in Google): the calendar
 * follow-through echo write and the project touch are skipped (the pull never wrote them), but a show rehearsal's
 * finance resync still runs (its date may have moved).
 */
export interface SessionUpdateOptions { origin?: "UI" | "SUNNY" | "CALENDAR_PULL" }

export async function updateSession(id: string, body: SessionPatch, opts: SessionUpdateOptions = {}): Promise<{ session: Record<string, unknown>; calendarSynced: boolean | null }> {
  const fromCalendar = opts.origin === "CALENDAR_PULL";
  const { date, startTime, endTime, status, sessionType, notes, photographer, location, summary, cost, paymentStatus } = body;
  let { startIso, endIso } = body;
  const patch: Record<string, unknown> = {};
  if (date !== undefined) patch.date = date || null;
  if (startTime !== undefined) patch.start_time = startTime || null;
  if (endTime !== undefined) patch.end_time = endTime || null;
  if (status !== undefined) patch.status = status;
  if (sessionType !== undefined) patch.session_type = sessionType;
  if (notes !== undefined) patch.notes = notes;
  if (photographer !== undefined) patch.photographer = photographer;
  if (location !== undefined) patch.location = location;
  if (cost !== undefined) {
    const costNum = cost === "" || cost == null ? null : Number(cost);
    if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) throw new SessionInputError("עלות לא תקינה");
    if (costNum != null && costNum > 0) {
      const { data: cur } = await supabase.from("sessions").select("show_id, session_type").eq("id", id).maybeSingle();
      const c = cur as { show_id: string | null; session_type: string | null } | null;
      if (c?.show_id && (sessionType ?? c.session_type) === REHEARSAL_SESSION_TYPE) await refuseCollabRehearsalCost(c.show_id);
    }
    patch.cost = costNum;
  }
  const { data, error } = await supabase.from("sessions").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  const row = data as { show_id?: string | null; session_type?: string; date: string | null; start_time?: string | null; end_time?: string | null; cost: number | null; calendar_event_id?: string | null; project_id?: string | null };

  if (row.session_type === REHEARSAL_SESSION_TYPE && row.show_id) {
    try {
      const { getShow } = await import("@/lib/shows-store");
      const show = await getShow(row.show_id);
      if (show) {
        const { syncRehearsalFinance, syncShowFinance } = await import("@/lib/shows-finance-sync");
        const pay = paymentStatus === undefined ? undefined : paymentStatus === "שולם" ? "שולם" : "לא שולם";
        await syncRehearsalFinance({ id, date: row.date, cost: row.cost }, show, pay);
        await syncShowFinance(show);
      }
    } catch (e) {
      console.error("[sessions] rehearsal finance sync error:", e);
    }
  }

  // HARDENED: a date / time change moves the event even when the caller sent no absolute times.
  const moved = date !== undefined || startTime !== undefined || endTime !== undefined;
  if (!fromCalendar && moved && !startIso && !endIso && row.date && row.start_time) {
    const t = sessionCalendarTimes(row.date, String(row.start_time).slice(0, 5), row.end_time ? String(row.end_time).slice(0, 5) : null);
    startIso = t.start; endIso = t.end;
  }
  let calendarSynced: boolean | null = null;
  const calEventId = row.calendar_event_id;
  if (!fromCalendar && calEventId && (startIso || endIso || (typeof summary === "string" && summary.trim()))) {
    try {
      const { isConnected, updateCalendarEvent, calendarEventExists } = await import("@/lib/google-calendar");
      if ((await isConnected()) && (await calendarEventExists(calEventId))) {
        const upd: { startIso?: string; endIso?: string; summary?: string; keepSummaryIfAttendees?: boolean } = {};
        if (startIso) upd.startIso = startIso;
        if (endIso) upd.endIso = endIso;
        if (typeof summary === "string" && summary.trim()) { upd.summary = summary.trim(); upd.keepSummaryIfAttendees = true; }
        await updateCalendarEvent(calEventId, upd);
        calendarSynced = true;
      } else calendarSynced = false;
    } catch (calErr) {
      console.error("[sessions] calendar update error:", calErr);
      calendarSynced = false;
    }
  }
  if (row.project_id && !fromCalendar) touchProject(row.project_id).catch(() => {});
  return { session: data as Record<string, unknown>, calendarSynced };
}

/** Delete a session, then its Google event (best-effort, outcome reported). Linked expense rows are NOT deleted; a
 *  deleted show rehearsal re-derives the show split (hardened). */
export async function deleteSession(id: string): Promise<{ calendarDeleted: boolean | null; calendarError: string | null }> {
  const { data: session } = await supabase.from("sessions").select("calendar_event_id, project_id, show_id, session_type").eq("id", id).single();
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  // HARDENED (2026-09-27): a deleted show rehearsal no longer counts — re-derive the show's split exactly as a
  // rehearsal create / edit does (its expense row is kept, per the no-auto-delete rule).
  const rehShowId = (session as { show_id?: string | null; session_type?: string } | null)?.show_id;
  if (rehShowId && (session as { session_type?: string }).session_type === REHEARSAL_SESSION_TYPE) {
    try {
      const { getShow } = await import("@/lib/shows-store");
      const show = await getShow(rehShowId);
      if (show) { const { syncShowFinance } = await import("@/lib/shows-finance-sync"); await syncShowFinance(show); }
    } catch (e) { console.error("[sessions] rehearsal delete split re-sync error:", e); }
  }
  const calEventId = session?.calendar_event_id as string | null;
  let calendarDeleted: boolean | null = null;
  let calendarError: string | null = null;
  if (calEventId) {
    try {
      const { deleteCalendarEvent, isConnected } = await import("@/lib/google-calendar");
      if (await isConnected()) { await deleteCalendarEvent(calEventId); calendarDeleted = true; } else { calendarDeleted = false; calendarError = "Google Calendar לא מחובר"; }
    } catch (calErr) {
      calendarDeleted = false;
      calendarError = calErr instanceof Error ? calErr.message : "מחיקת האירוע מ-Google Calendar נכשלה";
    }
  }
  const delProjectId = (session as { project_id?: string } | null)?.project_id;
  if (delProjectId) touchProject(delProjectId).catch(() => {});
  return { calendarDeleted, calendarError };
}

export interface SessionView { projectId: string | null; showId: string | null; title: string; date: string | null; startTime: string | null; endTime: string | null; status: string; sessionType: string; notes: string; location: string; photographer: string; hasCalendarEvent: boolean }
export async function readSession(id: string): Promise<SessionView | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const t = (v: unknown) => (v ? String(v).slice(0, 5) : null);
  return { projectId: data.project_id ?? null, showId: data.show_id ?? null, title: data.title ?? "", date: data.date ?? null, startTime: t(data.start_time), endTime: t(data.end_time), status: data.status ?? "", sessionType: data.session_type ?? "", notes: data.notes ?? "", location: data.location ?? "", photographer: data.photographer ?? "", hasCalendarEvent: !!data.calendar_event_id };
}
/** Finance rows linked to a session (they are kept on delete — shown in the preview). */
export async function countSessionTransactions(id: string): Promise<number> {
  const { count, error } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("linked_session_id", id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
/** True when a session on this project triggers the Shalev + Owner push (same artist rule as lib/session-notify). */
export async function isShalevProject(projectId: string): Promise<boolean> {
  const { data } = await supabase.from("projects").select("artist").eq("id", projectId).maybeSingle();
  return ((data as { artist?: string } | null)?.artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes("שליו טסמה");
}

/** Owner decision 2026-09-27: a rehearsal of an unpaid-collaboration show never creates an automatic expense — a cost is
 *  refused BEFORE any write (the rehearsal itself is booked normally without a cost); a real exceptional expense is
 *  recorded explicitly in Finance. */
async function refuseCollabRehearsalCost(showId: string): Promise<void> {
  const { getShow } = await import("@/lib/shows-store");
  const { isUnpaidCollab } = await import("@/lib/shows-types");
  if (isUnpaidCollab(await getShow(showId))) throw new SessionInputError("זו הופעת שת״פ ללא תשלום — לחזרה שלה לא נוצרת הוצאה אוטומטית. קבעו את החזרה בלי עלות; הוצאה חריגה נרשמת פרטנית בכספים");
}
