import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";
import { getLabelArtistByName } from "@/lib/label-artists-store";

/**
 * "Session created" push — sent to OWNER + SHALEV, but ONLY when the new
 * session's project actually belongs to him (project.artist token match —
 * the SAME rule shalev-summary uses to attribute a session to him). The sole
 * caller is the owner-gated /api/sessions POST route, right after the insert
 * has fully succeeded — never on page load, refresh, or from a client-side
 * event (rb-session-created stays UI-refresh-only). Independent
 * (project-less) sessions can never be matched here — there is no
 * artist/client field on them to check.
 *
 * Two DIFFERENT payloads (owner sees "נקבע סשן עם שליו", Shalev sees "נקבע לך
 * סשן חדש") — so this makes two sendPushToRoles calls, each scoped to one
 * role, sharing the SAME eventId (`session_created:{sessionId}`). Per-user
 * event_key dedup + notification-history persistence are handled entirely
 * inside lib/push.ts `deliver` (event_key = `${eventId}:${recipientUserId}`)
 * — no new dedup mechanism, no lib/push.ts change.
 */

const SHALEV = "שליו טסמה";
function isShalevArtist(artist: string | null | undefined): boolean {
  return (artist ?? "").split(/[,،;]/).map((s) => s.trim()).includes(SHALEV);
}

// production OR ALLOW_SERVER_PUSH — mirrors every other notify wrapper
// (lib/beat-notify.ts, lib/red-artists/availability.ts) so a localhost/dev
// run never fires a real push.
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

const SHALEV_SCHEDULE_URL = "/red-artists?tab=schedule";
const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "יום ראשון, 26.07" — parsed as plain numbers (no local-timezone risk). */
function dayAndDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const dayName = HEB_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return dayName ? `יום ${dayName}, ${dd}.${mm}` : `${dd}.${mm}`;
}

/** "יום ראשון, 26.07 · 17:30–19:30" — exactly the two-line body's second line. */
function sessionLine(date: string | null, startTime: string | null, endTime: string | null): string {
  const day = date ? dayAndDate(date) : "";
  const hours = startTime ? (endTime ? `${startTime}–${endTime}` : startTime) : "";
  return [day, hours].filter(Boolean).join(" · ");
}

export interface CreatedSession {
  id: string;
  projectId: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
}

/** Fire-and-forget from the caller (never awaited into the response). */
export async function notifySessionCreatedForShalev(session: CreatedSession): Promise<void> {
  if (!session.id || !session.projectId || !pushAllowed()) return;
  try {
    const { data: proj } = await supabase
      .from("projects")
      .select("artist")
      .eq("id", session.projectId)
      .maybeSingle();
    if (!isShalevArtist((proj as { artist?: string } | null)?.artist)) return;

    const body = sessionLine(session.date, session.startTime, session.endTime);
    const eventId = `session_created:${session.id}`;
    const tag = `session-created-${session.id}`;

    const artist = await getLabelArtistByName(SHALEV).catch(() => null);
    const ownerUrl = artist ? `/label/artists/${artist.id}?tab=schedule` : SHALEV_SCHEDULE_URL;

    await Promise.allSettled([
      sendPushToRoles(["shalev"], {
        title: "נקבע לך סשן חדש",
        body,
        url: SHALEV_SCHEDULE_URL,
        tag,
        eventId,
      }),
      sendPushToRoles(["owner"], {
        title: "נקבע סשן עם שליו",
        body,
        url: ownerUrl,
        tag,
        eventId,
      }),
    ]);
  } catch (e) {
    // Best-effort: a push failure must never fail session creation.
    console.error("[session-notify] created", e instanceof Error ? e.message : e);
  }
}
