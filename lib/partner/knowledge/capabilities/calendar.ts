/**
 * Sunny knowledge — the Owner's LIVE CALENDAR as horizontal TIME CONTEXT for all of Redbloods. Owner-only, read-only.
 * Source of truth: Google Calendar, read through the trusted Redbloods MAIN integration (sanitized; no credentials).
 *
 *   summary       the window at a glance: per day, what is booked, what is linked to Redbloods, holidays, overlaps
 *   events        events (optional from / to / filter) with category + relationship quality + edges
 *   event         one event in full + the Redbloods context of everything it is reliably linked to
 *   availability  per day occupied / free (inside 08:00–22:00) / all-day items / overlaps — never "free" on failure
 *   context       Redbloods → Calendar: for a project / client / show / release / label artist: canonical events,
 *                 inferred events, ambiguous ones, and the Owner's occupancy until the relevant date
 * Failure is never an empty calendar: every answer carries the read status.
 */
import type { KnowledgeCapability, KnowledgeReadResult } from "../types";
import type { GatewaySources } from "../../gateway/core";
import type { OperationsRaw } from "../../operations/types";
import type { PartnerCompanyState } from "../../eyes/types";
import type { CalendarWindowResult, SunnyCalendarEvent } from "../../calendar/types";
import { buildCalendarLinkIndex, eventsForEntity, linkCalendarEvent, type LinkedCalendarEvent } from "../../calendar/links";
import { availability, dayList, type DayAvailability } from "../../calendar/availability";
import { buildProjectView } from "../../projects/view";
import { idOf, item, partner, record, result, sfact } from "./common";

const SRC = "CALENDAR" as const;
const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ymdIL = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)));
const timeIL = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? null : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)));

interface Cal { res: CalendarWindowResult | null; linked: LinkedCalendarEvent[]; st: PartnerCompanyState | null; ops: OperationsRaw | null; usable: boolean }
function cal(src: GatewaySources): Cal {
  const res = ok(src.calendar);
  const st = ok(src.state) as PartnerCompanyState | null;
  const ops = ok(src.operations) as OperationsRaw | null;
  const usable = !!res && (res.status === "CALENDAR_DATA_AVAILABLE" || res.status === "CALENDAR_PARTIAL");
  const idx = buildCalendarLinkIndex(ops, st);
  return { res, st, ops, usable, linked: usable ? res!.events.map((e) => linkCalendarEvent(e, idx)) : [] };
}

/** The honest non-answer: the calendar could not be (fully) read — never "no events". */
function notReadable(c: Cal): KnowledgeReadResult {
  const status = c.res?.status ?? "CALENDAR_PROVIDER_ERROR";
  const why = c.res?.reasons.join("; ") || "the live calendar was not read";
  return result([], {
    completeness: "UNKNOWN",
    summary: [sfact("CALENDAR_STATUS", "מצב קריאת היומן", status, "FACT", SRC)],
    missing: [{ fact: "live calendar", whyNeeded: `${status}: ${why} — this is NOT an empty calendar; availability is unknown` }],
    coverage: [partner(status === "CALENDAR_NEEDS_REAUTH" ? "Google דחה את החיבור — צריך לחבר מחדש את היומן ב-Redbloods." : status === "CALENDAR_NOT_CONNECTED" ? "היומן לא מחובר ל-Redbloods." : "לא ניתן היה לקרוא את היומן עכשיו — אי אפשר לדעת מה פנוי.")],
  });
}

const eventFields = (l: LinkedCalendarEvent, full = false) => {
  const e = l.event;
  return {
    eventId: e.id, calendar: e.calendarName, date: ymdIL(e.start), start: e.allDay ? null : timeIL(e.start), end: e.allDay ? null : timeIL(e.end), allDay: e.allDay, durationMinutes: e.durationMinutes,
    category: l.category, relationship: l.quality, edges: l.edges, ...(l.quality === "AMBIGUOUS" ? { candidates: l.candidates } : {}),
    location: e.location, status: e.status, eventType: e.eventType, busy: e.transparency === "opaque", selfResponse: e.selfResponse, invited: e.invited, recurring: !!e.recurringEventId,
    hasMeetingLink: e.hasMeetingLink, hasAttachments: e.hasAttachments, untitled: e.untitled,
    ...(full ? {
      description: e.description ? { text: e.description, trust: "RECORD" } : null, timeZone: e.timeZone, attendees: e.attendees, attendeesOmitted: e.attendeesOmitted, organizer: e.organizer, creator: e.creator,
      recurringEventId: e.recurringEventId, originalStartTime: e.originalStartTime, recurrence: e.recurrence, visibility: e.visibility, created: e.created, updated: e.updated, attachmentCount: e.attachmentCount, startRaw: e.start, endRaw: e.end,
    } : {}),
    meaning: l.category === "HOLIDAY" ? "holiday — scheduling context, not a business event" : l.quality === "UNLINKED" ? "not linked to Redbloods — counts for the Owner's availability only" : l.quality === "AMBIGUOUS" ? "matches several Redbloods entities — not linked" : l.quality === "TEXT_MATCH" ? "linked by the title only (inferred, not a stored link)" : "a Redbloods record stores this event (canonical)",
  };
};
const evItem = (l: LinkedCalendarEvent, full = false) => item({ id: l.event.id, entity: l.edges.find((e) => /^(project|client|show|session|label-artist):/.test(e.to))?.to ?? null, label: l.event.title ? record(l.event.title) : partner("(ללא כותרת)"), epistemic: l.quality === "CANONICAL_RELATION" ? "FACT" : "OBSERVATION", source: SRC, relationQuality: l.quality === "CANONICAL_RELATION" ? "ID" : l.quality === "TEXT_MATCH" ? "TEXT_MATCH" : undefined, fields: eventFields(l, full) });

const statusFacts = (c: Cal) => [sfact("CALENDAR_STATUS", "מצב קריאת היומן", c.res!.status, "FACT", SRC), sfact("WINDOW", "טווח", { from: ymdIL(c.res!.window.start), to: ymdIL(c.res!.window.end), fetchedAt: c.res!.fetchedAt, cache: c.res!.cache }, "FACT", SRC)];
const completenessOf = (c: Cal) => (c.res!.status === "CALENDAR_PARTIAL" ? "PARTIAL" as const : "COMPLETE" as const);
const partialNote = (c: Cal) => (c.res!.status === "CALENDAR_PARTIAL" ? [partner(`קריאה חלקית: ${c.res!.reasons.join("; ")} — אין להסיק לוח זמנים מלא.`)] : []);

function inRange(l: LinkedCalendarEvent, from?: string, to?: string) {
  const d = ymdIL(l.event.start), dEnd = l.event.allDay ? l.event.end : ymdIL(l.event.end);
  return (!from || dEnd >= from) && (!to || d <= to);
}

function entityAnchor(src: GatewaySources, c: Cal, key: string): { label: string; anchorDate: string | null; related: string[]; context: Record<string, unknown> } {
  const id = idOf(key);
  if (key.startsWith("project:")) {
    const v = buildProjectView(src, id);
    return { label: v.identity?.name ?? key, anchorDate: v.identity?.deadline ?? null, related: [key], context: { status: v.identity?.status, deadline: v.identity?.deadline, money: v.money?.verdict ?? null, signals: v.signals.map((s) => s.code), sessions: v.work.sessions, waiting: v.work.projectActions } };
  }
  if (key.startsWith("show:")) {
    const s = c.st?.domains.shows.data?.items.find((x) => x.id === id);
    return { label: s?.name ?? key, anchorDate: s?.dateYmd ?? null, related: [key], context: { status: s?.status ?? null, date: s?.dateYmd ?? null, djConfirmation: s?.djConfirmationStatus ?? null, paymentStatus: s?.paymentStatus ?? null } };
  }
  if (key.startsWith("release:")) {
    const r = c.st?.domains.releasesFull.data?.items.find((x) => x.projectId === id);
    return { label: key, anchorDate: r?.targetYmd ?? null, related: [`project:${id}`, key], context: { stage: r?.stage ?? null, targetDate: r?.targetYmd ?? null, releasedAt: r?.releasedAt ?? null } };
  }
  if (key.startsWith("client:")) {
    const cl = c.st?.domains.clients.data?.items.find((x) => x.id === id);
    const projects = (c.st?.domains.projects.data?.open ?? []).filter((p) => (p.artistText ?? "").split(/[,،;]/).map((t) => t.trim().toLowerCase()).includes((cl?.name ?? "").toLowerCase()));
    return { label: cl?.name ?? key, anchorDate: null, related: [key, ...projects.map((p) => `project:${p.id}`)], context: { openProjectsByName: projects.map((p) => ({ key: `project:${p.id}`, name: p.name, link: "TEXT_MATCH" })) } };
  }
  const la = c.st?.domains.labelArtists.data?.items.find((x) => x.id === id);
  return { label: la?.name ?? key, anchorDate: null, related: [key], context: {} };
}

export const calendarCap: KnowledgeCapability = {
  id: "calendar", domain: "COMPANY", titleHe: "יומן — הזמן של החברה",
  descriptionForModel: "The Owner's LIVE Google Calendar (every calendar incl. personal events, holidays, all-day, recurring, invited, untitled) as TIME CONTEXT for Redbloods. Modes: summary (per day: booked time, Redbloods-linked events, holidays, overlaps), events (from / to / filter), event (event_id: full detail + the Redbloods context of what it is linked to), availability (from / to: occupied vs free 08:00–22:00; free = no calendar commitment, not 'good for work'), context (entity = project / client / show / release / label artist: its canonical + inferred events and the Owner's occupancy until the deadline / show / release date). Relationship quality: CANONICAL (a Redbloods record stores the event id) / TEXT_MATCH (title only) / AMBIGUOUS / UNLINKED (personal: availability only, never a business fact). A read failure is never 'empty' or 'free' — check CALENDAR_STATUS.",
  examplesHe: ["מה יש לי השבוע?", "מתי אני פנוי השבוע?", "יש לי זמן לעבוד על הפרויקט הזה לפני יום חמישי?", "היום עמוס?", "יש התנגשות עם הסשן?", "יש לי משהו בערב?", "מה קשור לפרויקט הזה ביומן?"],
  modes: { summary: { descriptionForModel: "Window summary per day" }, events: { descriptionForModel: "Events (optional from / to / filter)" }, event: { descriptionForModel: "One event (param event_id) + its Redbloods context" }, availability: { descriptionForModel: "Occupied / free per day (from / to)" }, context: { descriptionForModel: "Calendar context of one Redbloods entity (param entity)" } },
  defaultMode: "summary",
  params: {
    from: { kind: "ymd", descriptionForModel: "First day (YYYY-MM-DD, Israel). With to: at most 45 days" },
    to: { kind: "ymd", descriptionForModel: "Last day (YYYY-MM-DD)" },
    filter: { kind: "enum", values: ["all", "redbloods", "linked", "unlinked", "holidays", "work", "busy"], descriptionForModel: "events: which events" },
    event_id: { kind: "text", maxLength: 120, descriptionForModel: "A calendar event id (from mode events)" },
    entity: { kind: "entityKey", types: ["project", "client", "show", "release", "label-artist"], descriptionForModel: "A Redbloods entity key (partner_resolve)" },
  },
  entityScope: { types: ["project", "client", "show", "release", "label-artist"], param: "entity", mode: "context", limit: 6 },
  paging: { defaultLimit: 40, maxLimit: 50 }, recordTextLimit: 2000,
  access: { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" },
  needs: ["CALENDAR", "STATE", "OPERATIONS"], optionalNeeds: ["FINANCE"],
  read(src, q) {
    const c = cal(src);
    if (!c.usable) return notReadable(c);
    const res = c.res!;
    const from = q.params.from, to = q.params.to ?? q.params.from;
    const base = { summary: statusFacts(c), completeness: completenessOf(c), coverage: [...partialNote(c), partner("אירוע שלא מקושר ל-Redbloods (אישי / חג) משפיע רק על הזמינות — הוא לא עובדה עסקית.")] };

    if (q.mode === "event") {
      if (!q.params.event_id) return result([], { ...base, completeness: "UNKNOWN", missing: [{ fact: "event_id", whyNeeded: "pass params.event_id (see mode events)" }] });
      const l = c.linked.find((x) => x.event.id === q.params.event_id);
      if (!l) return result([], { ...base, completeness: "UNKNOWN", missing: [{ fact: "event", whyNeeded: "not in the loaded window — pass from / to around its date" }] });
      const contexts = l.edges.filter((e) => /^(project|show|client|release|label-artist):/.test(e.to)).map((e) => ({ to: e.to, quality: e.quality, ...entityAnchor(src, c, e.to).context }));
      return result([evItem(l, true)], { ...base, summary: [...base.summary, sfact("REDBLOODS_CONTEXT", "הקשר ב-Redbloods", contexts, l.quality === "CANONICAL_RELATION" ? "FACT" : "DERIVED", "PROJECTS")] });
    }
    if (q.mode === "availability" || q.mode === "summary") {
      const days = dayList(from ?? ymdIL(res.window.start), to ?? ymdIL(res.window.end));
      const av = availability(res.events, days, res.status);
      if (q.mode === "availability") return result(av.map((d) => item({ id: d.date, label: partner(d.date), epistemic: "DERIVED", source: SRC, fields: { ...d, note: d.status === "KNOWN" ? "free = no calendar commitment (not automatically good for work)" : "partial calendar data — free time not asserted" } })), base);
      const byDay = new Map<string, LinkedCalendarEvent[]>();
      for (const l of c.linked) for (const d of days) if (inRange(l, d, d)) byDay.set(d, [...(byDay.get(d) ?? []), l]);
      const items = av.map((d: DayAvailability) => {
        const ls = byDay.get(d.date) ?? [];
        return item({ id: d.date, label: partner(d.date), epistemic: "DERIVED", source: SRC, fields: {
          events: ls.length, occupiedMinutes: d.occupiedMinutes, freeBlocks: d.free, holidays: d.allDay.filter((a) => a.holiday).map((a) => a.title), allDay: d.allDay.filter((a) => !a.holiday).map((a) => a.title), overlaps: d.overlaps.length,
          redbloods: ls.filter((l) => l.quality === "CANONICAL_RELATION" || l.quality === "TEXT_MATCH").map((l) => ({ title: l.event.title, start: l.event.allDay ? null : timeIL(l.event.start), category: l.category, relationship: l.quality, links: l.edges.map((e) => e.to) })),
          otherTimed: ls.filter((l) => !l.event.allDay && l.quality !== "CANONICAL_RELATION" && l.quality !== "TEXT_MATCH").map((l) => ({ title: l.event.title, start: timeIL(l.event.start), end: timeIL(l.event.end), busy: l.event.transparency === "opaque" })),
        } });
      });
      const cat = c.linked.reduce<Record<string, number>>((m, l) => ({ ...m, [l.category]: (m[l.category] ?? 0) + 1 }), {});
      const qual = c.linked.reduce<Record<string, number>>((m, l) => ({ ...m, [l.quality]: (m[l.quality] ?? 0) + 1 }), {});
      return result(items, { ...base, summary: [...base.summary, sfact("BY_CATEGORY", "לפי סוג", cat, "DERIVED", SRC), sfact("BY_RELATIONSHIP", "לפי איכות קישור", qual, "DERIVED", SRC), sfact("CALENDARS", "יומנים", res.calendars.map((x) => ({ name: x.name, primary: x.primary, holiday: x.holiday, read: x.read, events: x.events })), "FACT", SRC)] });
    }
    if (q.mode === "context") {
      if (!q.params.entity) return result([], { ...base, completeness: "UNKNOWN", missing: [{ fact: "entity", whyNeeded: "pass params.entity (partner_resolve)" }] });
      const a = entityAnchor(src, c, q.params.entity);
      const sets = a.related.map((k) => eventsForEntity(c.linked, k));
      const uniq = (ls: LinkedCalendarEvent[]) => ls.filter((l, i) => ls.findIndex((x) => x.event.id === l.event.id) === i);
      const canonical = uniq(sets.flatMap((s) => s.canonical)), inferred = uniq(sets.flatMap((s) => s.inferred)).filter((l) => !canonical.includes(l)), ambiguous = uniq(sets.flatMap((s) => s.ambiguous));
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(src.now);
      const winEnd = ymdIL(res.window.end);
      const until = a.anchorDate && a.anchorDate >= today ? (a.anchorDate < winEnd ? a.anchorDate : winEnd) : null;
      const av = until ? availability(res.events, dayList(today, until), res.status) : [];
      const occupancy = until ? { from: today, to: until, anchorBeyondWindow: !!a.anchorDate && a.anchorDate > winEnd, daysKnown: av.filter((d) => d.status === "KNOWN").length, freeMinutes: av.every((d) => d.free) ? av.reduce((s, d) => s + (d.free ?? []).reduce((x, f) => x + f.minutes, 0), 0) : null, occupiedMinutes: av.reduce((s, d) => s + (d.occupiedMinutes ?? 0), 0), holidays: av.flatMap((d) => d.allDay.filter((x) => x.holiday).map((x) => `${d.date} ${x.title ?? ""}`.trim())), overlapDays: av.filter((d) => d.overlaps.length).map((d) => d.date) } : null;
      const items = [...canonical.map((l) => evItem(l)), ...inferred.map((l) => evItem(l)), ...ambiguous.map((l) => evItem(l))];
      return result(items, { ...base, summary: [...base.summary, sfact("ENTITY", "ישות", { key: q.params.entity, label: a.label, anchorDate: a.anchorDate }, "FACT", "PROJECTS"), sfact("REDBLOODS_STATE", "מצב ב-Redbloods", a.context, "DERIVED", "PROJECTS"),
        sfact("RELATED_EVENTS", "אירועים קשורים", { canonical: canonical.length, inferred: inferred.length, ambiguous: ambiguous.length }, "DERIVED", SRC), sfact("OWNER_OCCUPANCY_UNTIL_ANCHOR", "עומס הבעלים עד התאריך הרלוונטי", occupancy, "DERIVED", SRC)],
        coverage: [...base.coverage, partner("CANONICAL = רשומה ב-Redbloods שומרת את מזהה האירוע; TEXT_MATCH = לפי הכותרת בלבד (הסקה); AMBIGUOUS = לא נבחר.")] });
    }
    // events
    const f = q.params.filter ?? "all";
    const pick = c.linked.filter((l) => inRange(l, from, to)).filter((l) =>
      f === "all" ? true : f === "redbloods" ? l.quality === "CANONICAL_RELATION" : f === "linked" ? l.quality === "CANONICAL_RELATION" || l.quality === "TEXT_MATCH" : f === "unlinked" ? l.quality === "UNLINKED" || l.quality === "AMBIGUOUS"
      : f === "holidays" ? l.category === "HOLIDAY" : f === "work" ? ["REDBLOODS_SESSION", "REDBLOODS_MEETING", "REDBLOODS_SHOW", "REDBLOODS_SOCIAL", "LIKELY_WORK"].includes(l.category) : l.event.transparency === "opaque" && l.event.status !== "cancelled");
    return result(pick.map((l) => evItem(l)), base);
  },
};

export type { SunnyCalendarEvent };
