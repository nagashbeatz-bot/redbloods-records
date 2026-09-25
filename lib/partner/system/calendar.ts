/**
 * Sunny System Awareness — the CALENDAR as a CROSS-DOMAIN CONTEXT SOURCE (served as system_awareness calendar_model).
 * Semantic only: no env names, no secrets, no source paths.
 */
import { CALENDAR_CACHE_MS, CALENDAR_MAX_DAYS, CALENDAR_MAX_EVENTS, CALENDAR_MAX_PAGES_PER_CALENDAR, CALENDAR_PAGE_SIZE } from "../calendar/types";

export const CALENDAR_CONTEXT_CONTRACT = {
  role: "Horizontal time context for all of Redbloods — not an isolated domain. Every domain may use it; events that are not linked to Redbloods still matter for availability and capacity.",
  sourceOfTruth: "The Owner's Google Calendar (live). No local copy, no mirror, no second source of truth.",
  trustedIntegrationOwner: "The Redbloods main service: it alone holds the Google connection, reads Google (list calls only) and refreshes the stored credential exactly as the Calendar page does.",
  sunnyReadPath: "Google → Redbloods main service (sanitizes) → authenticated service-to-service read → Sunny connector → knowledge gateway. Sunny never holds or receives a Google credential.",
  tokenRefresh: "A Sunny read may make the main service refresh and persist the Google access token (normal credential maintenance, Owner-approved). No business data is written.",
  freshness: `Live, with a ${Math.round(CALENDAR_CACHE_MS / 1000)}-second cache in the main service per window.`,
  limits: { maxDaysPerRequest: CALENDAR_MAX_DAYS, maxEvents: CALENDAR_MAX_EVENTS, perCalendar: CALENDAR_PAGE_SIZE * CALENDAR_MAX_PAGES_PER_CALENDAR, defaultWindow: "7 days back → 37 days ahead (Israel dates)" },
  calendarsCovered: "Every calendar the Calendar page shows (primary, shared, subscribed incl. holiday calendars); free/busy-only and hidden calendars are excluded, as on the page.",
  fields: ["event id", "calendar id + display name", "holiday calendar flag", "title (untitled kept)", "description", "start / end / time zone / all-day / duration", "location", "attendees (name, email, response, organizer, optional, resource) + omitted flag", "the Owner's own response", "organizer / creator", "invited (external organizer)", "recurring event id / original start / recurrence rule", "status", "event type", "busy / free (transparency)", "visibility", "created / updated", "hasMeetingLink (never the link)", "hasAttachments + count (never the URLs)"],
  failureSemantics: {
    CALENDAR_DATA_AVAILABLE: "every calendar read completely",
    CALENDAR_PARTIAL: "a calendar failed or a cap was hit — never a full-schedule conclusion",
    CALENDAR_NOT_CONNECTED: "Redbloods has no Google connection",
    CALENDAR_NEEDS_REAUTH: "Google rejected the credential — the Owner reconnects in Redbloods",
    CALENDAR_PROVIDER_ERROR: "Google / network / main-service failure — NOT an empty calendar, NOT free time",
    CALENDAR_RANGE_TOO_LARGE: "request window over the limit — nothing read",
  },
  relationshipSemantics: {
    CANONICAL_RELATION: "a Redbloods session / meeting / show / social item stores the event id (the linked project / client / show follows from that record)",
    TEXT_MATCH: "the title names exactly one project or person — inferred, never stored as a fact",
    AMBIGUOUS: "several projects / people match — Sunny does not pick",
    UNLINKED: "personal / other — availability context only",
    HOLIDAY: "a subscribed holiday calendar — scheduling context, never a project event",
  },
  availabilitySemantics: "Per day inside 08:00–22:00 Israel: occupied = busy, non-cancelled, not-declined timed events (merged); free = gaps ≥ 30 minutes (no calendar commitment — not automatically work time); all-day items and holidays listed (they may block a day — Sunny says so); overlaps flagged. PARTIAL → free time not asserted; failure → UNKNOWN.",
  crossDomainUsage: [
    "PROJECTS: canonical + inferred events, the Owner's occupancy until the deadline (project_view calendar section; calendar context)",
    "SESSIONS / MEETINGS / SHOWS: stored event ids are the canonical bridge both ways",
    "CLIENTS: meetings / sessions linked by stored ids; title matches stay inferred",
    "SHOWS: the show's own event, rehearsals (sessions that store the show id), occupancy before the show",
    "RELEASES: work scheduled before the target date",
    "TASKS / COO: calendar is one input next to deadlines, money, waiting and team state",
  ],
  readCapabilities: ["calendar (summary / events / event / availability / context)", "project_view section calendar", "partner_entity enrichment for projects / clients / shows / releases / label artists"],
  futureWriteCapabilities: ["CREATE_CALENDAR_EVENT", "UPDATE_CALENDAR_EVENT", "DELETE_CALENDAR_EVENT", "SCHEDULE_SESSION", "SCHEDULE_MEETING", "RESCHEDULE_EVENT"],
  writesToday: "none — every calendar write is NOT_YET_EXECUTABLE and will need explicit Owner approval with external-effect (and, for deletes, destructive) confirmation.",
} as const;
