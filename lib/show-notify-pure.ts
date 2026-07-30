/**
 * Pure logic for the manual "שלח" (notify Shalev about a show) button — no
 * "server-only"/Supabase imports, testable from a plain script. Mirrors the
 * split already established for shalev-weekly-pure.ts / shalev-availability-
 * reminder-pure.ts / artist-balance-show-sync-pure.ts.
 */
import { STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult } from "./shalev-weekly-pure";

export { STUCK_PROCESSING_TIMEOUT_MS, classifyPushResult };

/** "YYYY-MM-DD" → "DD.MM.YYYY" (same convention as ArtistPortalPage.tsx's fmtShowDate). */
export function fmtShowDateForPush(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
}

/**
 * The push body — "{name} · {date} בשעה {time}", with location appended only
 * when present. NEVER includes amounts / artist fee / dj fee / payment data /
 * internal notes — the caller must never pass those fields in.
 */
export function buildShowNotifyBody(fields: { name: string; date: string | null; startTime: string | null; location: string | null }): string {
  const dateStr = fmtShowDateForPush(fields.date);
  const timeStr = fields.startTime || "—";
  const base = `${fields.name} · ${dateStr} בשעה ${timeStr}`;
  const loc = (fields.location ?? "").trim();
  return loc ? `${fields.name} · ${dateStr} · ${timeStr} · ${loc}` : base;
}

/**
 * The show's "version" — ONLY the fields a resend must react to (name, date,
 * time, location). Amounts/fees/payment_status are deliberately EXCLUDED so a
 * money-only edit can never re-open the send button.
 */
export interface ShowNotifyFingerprintInput {
  name: string;
  date: string | null;
  startTime: string | null;
  location: string | null;
}

export function computeShowNotifyFingerprint(f: ShowNotifyFingerprintInput): string {
  return JSON.stringify([f.name.trim(), f.date ?? "", f.startTime ?? "", (f.location ?? "").trim()]);
}

export function showNotifyClaimKey(showId: string): string {
  return `show_notify:${showId}`;
}

export interface ShowNotifyClaimValue {
  status: "processing" | "sent" | "failed";
  fingerprint: string;
  claimedAt: string;
  sentAt?: string;
}

export type ShowNotifyClaimDecision =
  | { action: "insert" }      // no row yet for this show at all
  | { action: "cas_update" }  // safe to (re)claim: new version, stuck processing, or a prior failure
  | { action: "already_sent" }   // same version already sent — 409, no new push
  | { action: "in_progress" };   // same version currently being sent (double-click) — 409, no new push

/**
 * What to do with an existing claim row for showNotifyClaimKey(showId), given
 * the show's CURRENT fingerprint (recomputed fresh server-side every time —
 * never trusted from the client).
 */
export function decideShowNotifyClaim(existing: ShowNotifyClaimValue | null, fingerprint: string, now: Date): ShowNotifyClaimDecision {
  if (!existing) return { action: "insert" };
  if (existing.fingerprint !== fingerprint) return { action: "cas_update" }; // name/date/time/location changed → new version
  if (existing.status === "sent") return { action: "already_sent" };
  if (existing.status === "processing") {
    const age = now.getTime() - new Date(existing.claimedAt).getTime();
    if (age > STUCK_PROCESSING_TIMEOUT_MS) return { action: "cas_update" }; // stuck (crashed mid-send) → safe to reclaim
    return { action: "in_progress" };
  }
  return { action: "cas_update" }; // status === "failed", same version → retry allowed
}

/** True while `status` (a show row's own field) counts as "still upcoming" —
 *  the exact same rule the shows-summary routes already use to build the
 *  "הופעות קרובות" list this button renders next to. */
export function isUpcomingShowStatus(status: string): boolean {
  return status === "אושרה" || status === "נסגר";
}
