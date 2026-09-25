/**
 * Sunny LIVE CALENDAR — relationship engine. Pure. Never upgrades an inferred link into canonical state.
 *
 *   CANONICAL_RELATION  a Redbloods record STORES this Google event id (session / meeting / show / social content)
 *   TEXT_MATCH          the event title names exactly one project (or one client / label artist) — inferred
 *   AMBIGUOUS           the title matches several projects / people — Sunny must not pick
 *   UNLINKED            no reliable relationship (personal events, holidays, …) — still counts for availability
 *
 * Categories are about MEANING, not links: HOLIDAY (subscribed holiday calendar) and PERSONAL_OR_OTHER are never
 * turned into business facts.
 */
import type { OperationsRaw, OpsCalendarLink } from "../operations/types";
import type { PartnerCompanyState } from "../eyes/types";
import type { SunnyCalendarEvent } from "./types";

export type CalendarLinkQuality = "CANONICAL_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNLINKED";
export type CalendarEventCategory = "REDBLOODS_SESSION" | "REDBLOODS_MEETING" | "REDBLOODS_SHOW" | "REDBLOODS_SOCIAL" | "LIKELY_WORK" | "HOLIDAY" | "PERSONAL_OR_OTHER";
export interface CalendarEdge { to: string; quality: Exclude<CalendarLinkQuality, "UNLINKED">; basis: string; via?: string }
export interface LinkedCalendarEvent { event: SunnyCalendarEvent; quality: CalendarLinkQuality; category: CalendarEventCategory; edges: CalendarEdge[]; candidates: string[] }

const norm = (t: string) => t.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const WORK_WORDS = ["סשן", "session", "studio", "סטודיו", "הקלטה", "recording", "מיקס", "mix", "מאסטר", "master", "חזרה", "rehearsal", "הופעה", "show", "פגישה", "meeting", "צילום", "shoot", "קליפ"];

export interface CalendarLinkIndex { byEvent: Map<string, OpsCalendarLink[]>; projects: Array<{ id: string; name: string }>; people: Array<{ key: string; name: string }> }

export function buildCalendarLinkIndex(ops: OperationsRaw | null, st: PartnerCompanyState | null): CalendarLinkIndex {
  const byEvent = new Map<string, OpsCalendarLink[]>();
  for (const l of ops?.calendarLinks?.rows ?? []) byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l]);
  const meta = ops?.projectsMeta?.rows ?? [];
  const projects = (meta.length ? meta.map((p) => ({ id: p.id, name: p.name })) : (st?.domains.projects.data?.open ?? []).map((p) => ({ id: p.id, name: p.name }))).filter((p) => p.name.trim().length >= 3);
  const people = [
    ...(st?.domains.clients.data?.items ?? []).map((c) => ({ key: `client:${c.id}`, name: c.name })),
    ...(st?.domains.labelArtists.data?.items ?? []).map((a) => ({ key: `label-artist:${a.id}`, name: a.name })),
  ].filter((p) => p.name.trim().length >= 3);
  return { byEvent, projects, people };
}

export function linkCalendarEvent(ev: SunnyCalendarEvent, idx: CalendarLinkIndex): LinkedCalendarEvent {
  const stored = idx.byEvent.get(ev.id) ?? (ev.recurringEventId ? idx.byEvent.get(ev.recurringEventId) : undefined) ?? [];
  if (stored.length) {
    const edges: CalendarEdge[] = [];
    for (const l of stored) {
      edges.push({ to: l.kind === "SESSION" ? `session:${l.entityId}` : l.kind === "SHOW" ? `show:${l.entityId}` : `${l.kind.toLowerCase()}:${l.entityId}`, quality: "CANONICAL_RELATION", basis: `the ${l.kind.toLowerCase().replace("_", " ")} record stores this calendar event id` });
      if (l.projectId) edges.push({ to: `project:${l.projectId}`, quality: "CANONICAL_RELATION", basis: `via the ${l.kind.toLowerCase()} record's project id`, via: l.entityId });
      if (l.showId && l.kind !== "SHOW") edges.push({ to: `show:${l.showId}`, quality: "CANONICAL_RELATION", basis: `via the ${l.kind.toLowerCase()} record's show id`, via: l.entityId });
      if (l.clientId) edges.push({ to: `client:${l.clientId}`, quality: "CANONICAL_RELATION", basis: `via the ${l.kind.toLowerCase()} record's client id`, via: l.entityId });
    }
    const k = stored[0].kind;
    return { event: ev, quality: "CANONICAL_RELATION", category: k === "SESSION" ? "REDBLOODS_SESSION" : k === "MEETING" ? "REDBLOODS_MEETING" : k === "SHOW" ? "REDBLOODS_SHOW" : "REDBLOODS_SOCIAL", edges: dedupe(edges), candidates: [] };
  }
  if (ev.holidayCalendar) return { event: ev, quality: "UNLINKED", category: "HOLIDAY", edges: [], candidates: [] };
  const title = norm(ev.title ?? "");
  const hay = norm(`${ev.title ?? ""} ${ev.location ?? ""}`);
  const projectHits = title ? idx.projects.filter((p) => hay.includes(norm(p.name))) : [];
  const segments = title.split(/\s*[-–—|/,·:]\s*/).map((x) => x.trim()).filter(Boolean);
  const personHits = title ? idx.people.filter((p) => segments.includes(norm(p.name)) || (norm(p.name).split(" ").length > 1 && title.includes(norm(p.name)))) : [];
  const workish = WORK_WORDS.some((w) => title.includes(w));
  const candidates = [...projectHits.map((p) => `project:${p.id}`), ...personHits.map((p) => p.key)];
  if (projectHits.length > 1 || (projectHits.length === 0 && personHits.length > 1 && new Set(personHits.map((p) => norm(p.name))).size > 1)) {
    return { event: ev, quality: "AMBIGUOUS", category: workish ? "LIKELY_WORK" : "PERSONAL_OR_OTHER", edges: [], candidates };
  }
  const edges: CalendarEdge[] = [
    ...projectHits.map((p) => ({ to: `project:${p.id}`, quality: "TEXT_MATCH" as const, basis: `the event title contains the project name "${p.name}"` })),
    ...personHits.map((p) => ({ to: p.key, quality: "TEXT_MATCH" as const, basis: `the event title names "${p.name}"` })),
  ];
  if (edges.length) return { event: ev, quality: "TEXT_MATCH", category: "LIKELY_WORK", edges: dedupe(edges), candidates };
  return { event: ev, quality: "UNLINKED", category: workish ? "LIKELY_WORK" : "PERSONAL_OR_OTHER", edges: [], candidates: [] };
}

const dedupe = (e: CalendarEdge[]) => e.filter((x, i) => e.findIndex((y) => y.to === x.to && y.quality === x.quality) === i);

/** Events related to one Redbloods entity key, split by relationship quality. */
export function eventsForEntity(linked: LinkedCalendarEvent[], key: string) {
  return {
    canonical: linked.filter((l) => l.edges.some((e) => e.to === key && e.quality === "CANONICAL_RELATION")),
    inferred: linked.filter((l) => l.edges.some((e) => e.to === key && e.quality === "TEXT_MATCH")),
    ambiguous: linked.filter((l) => l.quality === "AMBIGUOUS" && l.candidates.includes(key)),
  };
}
