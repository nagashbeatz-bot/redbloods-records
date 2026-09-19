// ── Owner notifications bell: "חשוב" / "פעילות" classification ───────────────
// Pure, client-safe, display-only. The bell's rows already carry the push `tag`
// (persisted by lib/push.ts deliver()), so this classifies from that — no DB
// column, no API change, nothing about how notifications are created.
//
// "activity" = log / confirmation (someone visited, an action YOU took was
// delivered, a session was created, a payment/mix went out). Everything else is
// "important". The default is deliberately fail-visible: an unknown, new or
// tag-less notification lands in "important" rather than vanishing into
// "activity" (e.g. "Steven העלה קבצים סופיים" has no tag at all).
//
// This never filters what exists — the "הכל" tab shows every row.

export type OwnerNotifCategory = "important" | "activity";

// Exact tags → activity.
const ACTIVITY_TAGS = new Set<string>([
  // presence
  "steven-visit", "steven-login", "victor-visit",
  "shalev-entry", "cleantone-entry", "avi-entry",
  // cron summary that asks for nothing (morning-summary stays important)
  "evening-summary",
  // owner confirmation that the Steven deadline digest went out
  "steven-deadline-digest-owner",
]);

// Tag prefixes → activity. Each one is a confirmation of an action the Owner
// took, or a plain schedule/log entry.
const ACTIVITY_TAG_PREFIXES: readonly string[] = [
  "victor-work-sent-",          // "העבודה נשלחה לויקטור"
  "victor-completed-owner-",    // "Viktor עודכן"
  "victor-version-notes-ack-",  // "הערות נשלחו לוויקטור"
  "shalev-weekly-ack-",         // "העדכון השבועי נשלח לשליו ✅"
  "beat-assign-ack-",           // "התראת ביט נשלחה ✓"
  "sketch-new-ack-",            // "ההתראה נשלחה לשליו ✅"
  "sketch-upd-ack-",
  "show-notify-owner-",         // "שליו עודכן"
  "dj-show-notify-owner-",      // "DJ CLEANTONE עודכן"
  "steven-mix-ready-",          // "New mix job" (owner copy of what he sent Steven)
  "steven-mix-notes-",          // "New mix notes…" (owner copy of what he sent Steven)
  "steven-payment-",            // "Payment sent"
  // session-created-* ("נקבע סשן עם שליו"), session-reminder-ack-*, and the
  // cron's session-<id> ("🎵 סשן ב־14:00"). Agent alert type `session_needs_update`
  // uses an underscore, so it is NOT matched by this prefix.
  "session-",
];

// Same tag carries both a confirmation and something that matters — split by
// the exact title the sender uses (lib/steven-completed-pure.ts
// buildOwnerConfirmPush, lib/red-artists/availability.ts). Anything else on
// these tags (a failure notice, a new title) stays important.
const STEVEN_COMPLETED_OWNER_PREFIX = "steven-completed-owner-";
const STEVEN_COMPLETED_OK_TITLE = "התראה נשלחה ל-Steven";
const AVAILABILITY_TAG = "rb-availability";
const AVAILABILITY_ACK_TITLE = "הזמינות נשלחה";

export function ownerCategoryOf(n: { tag: string | null; title: string }): OwnerNotifCategory {
  const tag = (n.tag ?? "").trim();
  const title = (n.title ?? "").trim();
  if (!tag) return "important";

  if (tag.startsWith(STEVEN_COMPLETED_OWNER_PREFIX)) {
    return title === STEVEN_COMPLETED_OK_TITLE ? "activity" : "important";
  }
  if (tag === AVAILABILITY_TAG) {
    return title === AVAILABILITY_ACK_TITLE ? "activity" : "important";
  }

  if (ACTIVITY_TAGS.has(tag)) return "activity";
  if (ACTIVITY_TAG_PREFIXES.some((p) => tag.startsWith(p))) return "activity";
  return "important";
}
