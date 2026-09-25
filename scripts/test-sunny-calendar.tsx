/**
 * Tests — SUNNY LIVE CALENDAR + CROSS-SYSTEM INTELLIGENCE.
 * Read path (sanitize / pagination / caps / failure semantics / cache), the service-to-service boundary (secret,
 * connector fetch guard, remote client), the relationship engine (canonical / inferred / ambiguous / unlinked),
 * availability (never "free" on failure), the calendar capability (Calendar → Redbloods and Redbloods → Calendar),
 * project_view integration, secret exclusion and "no calendar write exists".
 *
 * Run with:   npx tsx scripts/test-sunny-calendar.tsx      NEVER touches Google or production.
 */
import fs from "node:fs";
import path from "node:path";
import { readCalendarWindowCore, clearCalendarCache, calendarWindow, ilOffset, type CalendarApi } from "../lib/partner/calendar/read-core";
import { sanitizeCalendarEvent } from "../lib/partner/calendar/sanitize";
import { verifyInternalAuth, INTERNAL_AUTH_HEADER } from "../lib/partner/calendar/internal-auth";
import { handleInternalCalendar } from "../lib/partner/calendar/internal-handler";
import { fetchCalendarWindowRemote, internalCalendarUrl } from "../lib/partner/calendar/remote";
import { buildCalendarLinkIndex, linkCalendarEvent } from "../lib/partner/calendar/links";
import { availability, dayList } from "../lib/partner/calendar/availability";
import { isAllowedMcpOnlyFetch } from "../lib/integrations/partner-mcp/mcp-only";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience } from "../lib/partner/knowledge/types";
import type { GatewaySources } from "../lib/partner/gateway/core";
import type { OperationsRaw } from "../lib/partner/operations/types";
import type { CalendarWindowResult } from "../lib/partner/calendar/types";
import { BUSINESS_ACTIONS, DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS } from "../lib/partner/system";
import { KNOWLEDGE_GAPS } from "../lib/partner/system/gaps";
import { SECURITY_GAPS } from "../lib/partner/system/people-view";
import { NOW, P, U, C_AVI, input } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const REG = PARTNER_KNOWLEDGE_REGISTRY;

// ── planted secrets ──
const ACCESS = "ya29.a0AfH6SMBplantedAccessTokenValue000000";
const REFRESH = "1//0gPlantedRefreshTokenValue0000000000";
const MEET = "https://meet.google.com/abc-defg-hij";
const ZOOM = "https://us02web.zoom.us/j/123456789?pwd=SECRETPWD";
const SHARE = "https://www.dropbox.com/scl/fi/x/brief.pdf?rlkey=RLKEY&dl=0";
const SECRET = "s".repeat(48);
const PLANTED = [ACCESS, REFRESH, MEET, ZOOM, "pwd=SECRETPWD", SHARE, "rlkey=RLKEY", SECRET, "https://drive.google.com/file/d/ATTACH"];

// ── fake Google ──
const PRIMARY = "owner@example.com", HOL = "he.jewish#holiday@group.v.calendar.google.com", STUDIO = "studio_abc@group.calendar.google.com";
const t = (d: string, h: string) => `${d}T${h}:00+03:00`;
const ev = (id: string, o: Record<string, unknown>) => ({ id, status: "confirmed", created: "2026-09-01T10:00:00Z", updated: "2026-09-02T10:00:00Z", ...o });
const EVENTS: Record<string, unknown[]> = {
  [PRIMARY]: [
    ev("evt-sess", { summary: "סשן - אבי מולה - אבי 1", start: { dateTime: t("2026-09-25", "10:00"), timeZone: "Asia/Jerusalem" }, end: { dateTime: t("2026-09-25", "14:00") } }),
    ev("evt-doctor", { summary: "תור לרופא", description: `bring card. join ${MEET} token ${ACCESS}`, start: { dateTime: t("2026-09-25", "16:00") }, end: { dateTime: t("2026-09-25", "17:00") } }),
    ev("evt-overlap", { summary: "שיחה עם רואה חשבון", start: { dateTime: t("2026-09-25", "13:00") }, end: { dateTime: t("2026-09-25", "13:30") }, hangoutLink: MEET, conferenceData: { entryPoints: [{ uri: ZOOM }] } }),
    ev("evt-meet", { summary: "פגישה", location: "קפה", start: { dateTime: t("2026-09-28", "12:00") }, end: { dateTime: t("2026-09-28", "13:00") } }),
    ev("evt-show", { summary: "הופעה", start: { dateTime: t("2026-09-29", "21:00") }, end: { dateTime: t("2026-09-29", "23:30") } }),
    ev("evt-rec_20260926", { summary: "חדר כושר", recurringEventId: "evt-rec", originalStartTime: { dateTime: t("2026-09-26", "08:00") }, start: { dateTime: t("2026-09-26", "08:00") }, end: { dateTime: t("2026-09-26", "09:00") } }),
    ev("evt-invite", { summary: "Label sync", organizer: { email: "partner@other.com", displayName: "Other Label" }, attendees: [{ email: PRIMARY, self: true, responseStatus: "tentative" }, { email: "partner@other.com", displayName: "Other", organizer: true, responseStatus: "accepted" }], start: { dateTime: t("2026-09-27", "11:00") }, end: { dateTime: t("2026-09-27", "12:00") }, attachments: [{ fileUrl: "https://drive.google.com/file/d/ATTACH", title: "deck" }], description: `deck ${SHARE}` }),
    ev("evt-untitled", { start: { dateTime: t("2026-09-26", "15:00") }, end: { dateTime: t("2026-09-26", "16:00") } }),
    ev("evt-declined", { summary: "משהו שדחיתי", attendees: [{ email: PRIMARY, self: true, responseStatus: "declined" }], start: { dateTime: t("2026-09-26", "18:00") }, end: { dateTime: t("2026-09-26", "19:00") } }),
    ev("evt-free", { summary: "תזכורת", transparency: "transparent", start: { dateTime: t("2026-09-26", "20:00") }, end: { dateTime: t("2026-09-26", "20:30") } }),
    ev("evt-infer", { summary: "מיקס אבי 1", start: { dateTime: t("2026-09-30", "10:00") }, end: { dateTime: t("2026-09-30", "11:00") } }),
    ev("evt-ambig", { summary: "חזרה אבי 1 + אבי 2", start: { dateTime: t("2026-09-30", "15:00") }, end: { dateTime: t("2026-09-30", "16:00") } }),
    ev("evt-allday", { summary: "יום חופש", start: { date: "2026-09-27" }, end: { date: "2026-09-28" } }),
  ],
  [HOL]: [ev("hol-yk", { summary: "Yom Kippur", start: { date: "2026-09-21" }, end: { date: "2026-09-22" }, transparency: "transparent" }), ev("hol-sukkot", { summary: "Sukkot Eve", start: { date: "2026-09-25" }, end: { date: "2026-09-26" }, transparency: "transparent" })],
  [STUDIO]: [ev("evt-sess", { summary: "dup across calendars", start: { dateTime: t("2026-09-25", "10:00") }, end: { dateTime: t("2026-09-25", "14:00") } })],
};
function fakeApi(o: { connected?: boolean; failCal?: string; listFail?: Error; pages?: number; empty?: boolean } = {}): CalendarApi & { calls: number } {
  const api = {
    calls: 0,
    async connected() { return o.connected ?? true; },
    async listCalendars() { if (o.listFail) throw o.listFail; return [{ id: PRIMARY, summary: PRIMARY, primary: true, accessRole: "owner", timeZone: "Asia/Jerusalem" }, { id: HOL, summary: "Holidays in Israel", accessRole: "reader" }, { id: STUDIO, summary: "Studio", accessRole: "writer" }, { id: "busy@x.com", summary: "busy only", accessRole: "freeBusyReader" }]; },
    async listEvents(calId: string, _a: string, _b: string, pageToken?: string) {
      api.calls++;
      if (calId === "busy@x.com") throw new Error("must never be read");
      if (o.failCal === calId) throw Object.assign(new Error("backend error"), { code: 500 });
      if (o.empty) return { items: [] };
      if (o.pages && calId === PRIMARY) { const n = Number(pageToken ?? 0); return { items: [ev(`p${n}`, { summary: `page ${n}`, start: { dateTime: t("2026-09-25", "09:00") }, end: { dateTime: t("2026-09-25", "09:30") } })], nextPageToken: n + 1 < o.pages ? String(n + 1) : null }; }
      return { items: EVENTS[calId] ?? [] };
    },
  };
  return api;
}

const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const OPS = {
  redFilms: sec([]), budgetItems: sec([]), budgetPayments: sec([]), equipment: sec([]), clipItems: sec([]), meetings: sec([]), projectActions: sec([]), beats: sec([]), beatAssignments: sec([]),
  campaigns: sec([]), contentItems: sec([]), promotions: sec([]), balanceCycles: sec([]), albumTracks: sec([]), engineerWork: sec([]), mixVersions: sec([]), mixComments: sec([]), finalFiles: sec([]), deliveries: sec([]),
  projectsMeta: sec([
    { id: P(2), name: "אבי 1", status: "בעבודה", projectType: "שיר", businessType: "לקוח", artistText: "אבי מולה", deadline: "2026-09-30", startDate: null, endDate: null, parentProject: null, isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-20T10:00:00Z" },
    { id: P(3), name: "אבי 2", status: "הושלם", projectType: "אלבום", businessType: "לקוח", artistText: "אבי מולה", deadline: null, startDate: null, endDate: null, parentProject: null, isHidden: false, plannedHours: null, plannedDays: null, updatedAt: "2026-09-20T10:00:00Z" },
  ]),
  calendarLinks: sec([
    { eventId: "evt-sess", kind: "SESSION" as const, entityId: U(900), projectId: P(2), clientId: null, showId: null, date: "2026-09-25", status: "מתוכנן" },
    { eventId: "evt-meet", kind: "MEETING" as const, entityId: U(811), projectId: null, clientId: C_AVI, showId: null, date: "2026-09-28", status: "נקבעה" },
    { eventId: "evt-show", kind: "SHOW" as const, entityId: U(960), projectId: null, clientId: C_AVI, showId: U(960), date: "2026-09-29", status: "סגור" },
  ]),
  integrations: { googleCalendarConnected: true, dropboxConnected: true },
} as OperationsRaw;
const src = (cal: CalendarWindowResult | "UNAVAILABLE"): GatewaySources => ({ now: NOW, state: { status: "OK", value: input({ contexts: [] }).state! }, identities: { cleantone: null }, operations: { status: "OK", value: OPS }, cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] },
  calendar: cal === "UNAVAILABLE" ? { status: "UNAVAILABLE", detail: "x" } : { status: "OK", value: cal } });
const q = (s: GatewaySources, mode: string, params: Record<string, string> = {}, aud = OWNER, limit = 50) => queryKnowledgeCore(REG, { capability: "calendar", mode, params, limit }, s, aud);

async function main() {
  section("1. Read core — sanitized, complete, honest");
  clearCalendarCache();
  const api = fakeApi();
  const r = await readCalendarWindowCore(api, "2026-09-21", "2026-09-30", NOW);
  check("status + cache miss", [r.status, r.cache], ["CALENDAR_DATA_AVAILABLE", "MISS"]);
  check("free/busy-only calendar never read; holiday + shared calendars read", r.calendars.map((c) => [c.name, c.holiday, c.read]), [[PRIMARY, false, "OK"], ["Holidays in Israel", true, "OK"], ["Studio", false, "OK"]]);
  const E = (id: string) => r.events.find((e) => e.id === id)!;
  ok("duplicate event across calendars kept once", r.events.filter((e) => e.id === "evt-sess").length === 1);
  ok("untitled event kept (untitled=true)", E("evt-untitled").untitled && E("evt-untitled").title === null);
  ok("holiday = all-day on a holiday calendar", E("hol-yk").allDay && E("hol-yk").holidayCalendar);
  ok("personal all-day event kept", E("evt-allday").allDay && !E("evt-allday").holidayCalendar);
  check("recurring instance identity", [E("evt-rec_20260926").recurringEventId, !!E("evt-rec_20260926").originalStartTime], ["evt-rec", true]);
  check("invited event: organizer, attendees + responses, own response", [E("evt-invite").invited, E("evt-invite").organizer?.email, E("evt-invite").attendees.map((a) => a.response), E("evt-invite").selfResponse], [true, "partner@other.com", ["tentative", "accepted"], "tentative"]);
  check("meeting link + attachments as booleans / count only", [E("evt-overlap").hasMeetingLink, E("evt-invite").hasAttachments, E("evt-invite").attachmentCount], [true, true, 1]);
  check("timezone / status / type / transparency / created / updated", [E("evt-sess").timeZone, E("evt-sess").status, E("evt-sess").eventType, E("evt-free").transparency, !!E("evt-sess").created, !!E("evt-sess").updated], ["Asia/Jerusalem", "confirmed", "default", "transparent", true, true]);
  ok("description kept, secrets inside it redacted", !!E("evt-doctor").description && E("evt-doctor").description!.includes("bring card"));
  check("planted secrets in the read result", PLANTED.filter((s) => JSON.stringify(r).includes(s)), []);
  const r2 = await readCalendarWindowCore(api, "2026-09-21", "2026-09-30", new Date(NOW.getTime() + 30_000));
  check("cache hit within 90s (no second Google read)", [r2.cache, api.calls], ["HIT", 3]);
  const r3 = await readCalendarWindowCore(api, "2026-09-21", "2026-09-30", new Date(NOW.getTime() + 120_000));
  check("cache expires after 90s", r3.cache, "MISS");

  section("2. Failure semantics — never 'empty' on failure");
  clearCalendarCache();
  check("46 days → RANGE_TOO_LARGE, nothing read", [(await readCalendarWindowCore(fakeApi(), "2026-09-01", "2026-10-16", NOW)).status], ["CALENDAR_RANGE_TOO_LARGE"]);
  check("45 days allowed", calendarWindow("2026-09-01", "2026-10-15").ok, true);
  check("not connected", (await readCalendarWindowCore(fakeApi({ connected: false }), "2026-09-24", "2026-09-30", NOW)).status, "CALENDAR_NOT_CONNECTED");
  clearCalendarCache();
  check("invalid_grant → NEEDS_REAUTH", (await readCalendarWindowCore(fakeApi({ listFail: new Error("invalid_grant") }), "2026-09-24", "2026-09-30", NOW)).status, "CALENDAR_NEEDS_REAUTH");
  clearCalendarCache();
  check("Google 500 → PROVIDER_ERROR (no events)", [(await readCalendarWindowCore(fakeApi({ listFail: Object.assign(new Error("boom"), { code: 500 }) }), "2026-09-24", "2026-09-30", NOW)).status], ["CALENDAR_PROVIDER_ERROR"]);
  clearCalendarCache();
  const part = await readCalendarWindowCore(fakeApi({ failCal: STUDIO }), "2026-09-24", "2026-09-30", NOW);
  check("one calendar failing → PARTIAL (not complete)", [part.status, part.calendars.find((c) => c.id === STUDIO)?.read], ["CALENDAR_PARTIAL", "FAILED"]);
  clearCalendarCache();
  const trunc = await readCalendarWindowCore(fakeApi({ pages: 9 }), "2026-09-24", "2026-09-30", NOW);
  check("pages past the cap → PARTIAL + truncated", [trunc.status, trunc.truncated, trunc.calendars[0].read, trunc.events.filter((e) => e.id.startsWith("p")).length], ["CALENDAR_PARTIAL", true, "TRUNCATED", 6]);
  clearCalendarCache();
  const empty = await readCalendarWindowCore(fakeApi({ empty: true }), "2026-09-24", "2026-09-30", NOW);
  check("a genuinely empty calendar is DATA_AVAILABLE with 0 events (distinct from failure)", [empty.status, empty.events.length], ["CALENDAR_DATA_AVAILABLE", 0]);
  check("Israel-time window (DST aware)", [ilOffset("2026-09-24"), ilOffset("2026-12-24")], ["+03:00", "+02:00"]);

  section("3. Service-to-service boundary");
  check("verifyInternalAuth", [verifyInternalAuth(null, SECRET), verifyInternalAuth("wrong", SECRET), verifyInternalAuth(SECRET, SECRET), verifyInternalAuth(SECRET, undefined), verifyInternalAuth(SECRET, "short")], ["MISSING", "INVALID", "OK", "NOT_CONFIGURED", "NOT_CONFIGURED"]);
  const req = (h: string | null, qs: Record<string, string> = { start: "2026-09-24", end: "2026-09-30" }) => ({ header: (n: string) => (n === INTERNAL_AUTH_HEADER ? h : null), query: (n: string) => qs[n] ?? null });
  let apiBuilt = 0;
  const mk = () => { apiBuilt++; return fakeApi(); };
  clearCalendarCache();
  check("missing secret → 401, nothing read", [(await handleInternalCalendar(req(null), { PARTNER_INTERNAL_SERVICE_SECRET: SECRET }, mk)).status, apiBuilt], [401, 0]);
  check("wrong secret → 401, nothing read", [(await handleInternalCalendar(req("x".repeat(48)), { PARTNER_INTERNAL_SERVICE_SECRET: SECRET }, mk)).status, apiBuilt], [401, 0]);
  check("secret not configured → 503", (await handleInternalCalendar(req(SECRET), {}, mk)).status, 503);
  check("on the MCP-only connector the endpoint does not exist → 404", (await handleInternalCalendar(req(SECRET), { PARTNER_INTERNAL_SERVICE_SECRET: SECRET, REDBLOODS_MCP_ONLY: "true" }, mk)).status, 404);
  const good = await handleInternalCalendar(req(SECRET), { PARTNER_INTERNAL_SERVICE_SECRET: SECRET }, mk);
  check("correct secret → 200 with sanitized data", [good.status, (good.body as CalendarWindowResult).status], [200, "CALENDAR_DATA_AVAILABLE"]);
  check("the response never contains the secret or a planted credential", PLANTED.filter((s) => JSON.stringify(good.body).includes(s)), []);
  const url = internalCalendarUrl({ PARTNER_MAIN_BASE_URL: "https://main.example.com/" })!;
  check("connector URL = exact https path", url, "https://main.example.com/api/partner/internal/calendar");
  check("http base rejected", internalCalendarUrl({ PARTNER_MAIN_BASE_URL: "http://main.example.com" }), null);
  const DB = "db.example.supabase.co";
  check("connector fetch guard", [
    isAllowedMcpOnlyFetch(new URL(`${url}?start=a&end=b`), "GET", DB, { internalReadUrls: [url] }),
    isAllowedMcpOnlyFetch(new URL(url), "POST", DB, { internalReadUrls: [url] }),
    isAllowedMcpOnlyFetch(new URL("https://main.example.com/api/transactions"), "GET", DB, { internalReadUrls: [url] }),
    isAllowedMcpOnlyFetch(new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events"), "GET", DB, { internalReadUrls: [url] }),
    isAllowedMcpOnlyFetch(new URL(`${url}`), "GET", DB, {}),
  ], [true, false, false, false, false]);
  let seenHeaders: Record<string, string> = {}; let seenRedirect: string | undefined;
  const fakeFetch = (async (_u: string, init: RequestInit) => { seenHeaders = init.headers as Record<string, string>; seenRedirect = init.redirect; return new Response(JSON.stringify(good.body), { status: 200 }); }) as unknown as typeof fetch;
  const env = { PARTNER_MAIN_BASE_URL: "https://main.example.com", PARTNER_INTERNAL_SERVICE_SECRET: SECRET };
  const rem = await fetchCalendarWindowRemote("2026-09-24", "2026-09-30", env, fakeFetch);
  check("remote read: sends the secret header, refuses redirects, returns the data", [rem.status, seenHeaders[INTERNAL_AUTH_HEADER] === SECRET, seenRedirect], ["CALENDAR_DATA_AVAILABLE", true, "error"]);
  check("remote 500 → PROVIDER_ERROR (not empty)", (await fetchCalendarWindowRemote("2026-09-24", "2026-09-30", env, (async () => new Response("x", { status: 500 })) as unknown as typeof fetch)).status, "CALENDAR_PROVIDER_ERROR");
  check("remote network failure → PROVIDER_ERROR", (await fetchCalendarWindowRemote("2026-09-24", "2026-09-30", env, (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch)).status, "CALENDAR_PROVIDER_ERROR");
  check("remote unexpected shape → PROVIDER_ERROR", (await fetchCalendarWindowRemote("2026-09-24", "2026-09-30", env, (async () => new Response(JSON.stringify({ token: "x" }), { status: 200 })) as unknown as typeof fetch)).status, "CALENDAR_PROVIDER_ERROR");
  check("remote not configured → PROVIDER_ERROR", (await fetchCalendarWindowRemote("2026-09-24", "2026-09-30", {})).status, "CALENDAR_PROVIDER_ERROR");
  ok("Google credentials stay MAIN-only: the connector path never imports the Google client", !/googleapis|google-calendar|getAuthenticatedClient|google_calendar_token/.test(code(read("lib/partner/calendar/remote.ts")) + code(read("lib/partner/calendar/internal-handler.ts"))));
  ok("the Google adapter is server-only and LIST-only", /import "server-only"/.test(read("lib/partner/calendar/google-api.ts")) && !/\.(insert|update|patch|delete|move|quickAdd|import)\(/.test(code(read("lib/partner/calendar/google-api.ts"))));
  ok("internal route: own authentication, bypasses only the cookie gate, exact path", /"\/api\/partner\/internal\/calendar"/.test(read("proxy.ts")) && /handleInternalCalendar/.test(read("app/api/partner/internal/calendar/route.ts")));

  section("4. Relationship engine");
  const st = input({ contexts: [] }).state!;
  const idx = buildCalendarLinkIndex(OPS, st);
  const L = (id: string) => linkCalendarEvent(r.events.find((e) => e.id === id)!, idx);
  check("canonical Session ↔ event (+ its project)", [L("evt-sess").quality, L("evt-sess").category, L("evt-sess").edges.map((e) => e.to).sort()], ["CANONICAL_RELATION", "REDBLOODS_SESSION", [`project:${P(2)}`, `session:${U(900)}`]]);
  check("canonical Meeting ↔ event (+ its client)", [L("evt-meet").quality, L("evt-meet").edges.map((e) => e.to).sort()], ["CANONICAL_RELATION", [`client:${C_AVI}`, `meeting:${U(811)}`]]);
  check("canonical Show ↔ event", [L("evt-show").quality, L("evt-show").category, L("evt-show").edges.some((e) => e.to === `show:${U(960)}`)], ["CANONICAL_RELATION", "REDBLOODS_SHOW", true]);
  check("title match stays inferred", [L("evt-infer").quality, L("evt-infer").edges.every((e) => e.quality === "TEXT_MATCH")], ["TEXT_MATCH", true]);
  check("two projects in the title → AMBIGUOUS (no edge)", [L("evt-ambig").quality, L("evt-ambig").edges.length, L("evt-ambig").candidates.length], ["AMBIGUOUS", 0, 2]);
  check("personal event → UNLINKED", [L("evt-doctor").quality, L("evt-doctor").category], ["UNLINKED", "PERSONAL_OR_OTHER"]);
  check("holiday → HOLIDAY, unlinked", [L("hol-sukkot").quality, L("hol-sukkot").category], ["UNLINKED", "HOLIDAY"]);

  section("5. Availability — occupancy, never 'free' on failure");
  const day = availability(r.events, ["2026-09-25"], r.status)[0];
  check("occupied blocks merge overlapping events (10–14 + 13–13:30) and personal 16–17", day.occupied.map((o) => `${o.start}-${o.end}`), ["10:00-14:00", "16:00-17:00"]);
  check("overlap flagged", day.overlaps.length, 1);
  check("free blocks inside 08–22 (personal event still occupies time)", day.free?.map((f) => `${f.start}-${f.end}`), ["08:00-10:00", "14:00-16:00", "17:00-22:00"]);
  check("holiday listed as all-day context (not blocking by itself)", day.allDay.map((a) => [a.title, a.holiday]), [["Sukkot Eve", true]]);
  const d26 = availability(r.events, ["2026-09-26"], r.status)[0];
  check("declined + transparent events do not occupy time; untitled + recurring do", [d26.occupied.map((o) => `${o.start}-${o.end}`), d26.nonBlocking], [["08:00-09:00", "15:00-16:00"], ["evt-declined", "evt-free"]]);
  check("PARTIAL → free time not asserted", availability(part.events, ["2026-09-25"], part.status)[0].free, null);
  check("failure → UNKNOWN, no free time", [availability([], ["2026-09-25"], "CALENDAR_PROVIDER_ERROR")[0].status, availability([], ["2026-09-25"], "CALENDAR_PROVIDER_ERROR")[0].free], ["UNKNOWN", null]);
  check("dayList", dayList("2026-09-29", "2026-10-01"), ["2026-09-29", "2026-09-30", "2026-10-01"]);

  section("6. calendar capability — Calendar → Redbloods and Redbloods → Calendar");
  const S = src(r);
  const sum = q(S, "summary", { from: "2026-09-25", to: "2026-09-26" });
  check("summary: status, per-day items, relationship counts", [sum.status, sum.summary.find((x) => x.code === "CALENDAR_STATUS")?.value, sum.items.length], ["OK", "CALENDAR_DATA_AVAILABLE", 2]);
  ok("summary shows Redbloods-linked events with their links and other timed events separately", JSON.stringify(sum.items[0].fields.redbloods).includes(`project:${P(2)}`) && JSON.stringify(sum.items[0].fields.otherTimed).includes("תור לרופא"));
  const evq = q(S, "event", { event_id: "evt-sess" });
  const ctx = evq.summary.find((x) => x.code === "REDBLOODS_CONTEXT")!.value as Array<Record<string, unknown>>;
  check("event → linked project context (status / deadline / signals)", [ctx[0].to, ctx[0].quality, ctx[0].status, ctx[0].deadline], [`project:${P(2)}`, "CANONICAL_RELATION", "בעבודה", "2026-09-30"]);
  const personal = q(S, "event", { event_id: "evt-doctor" });
  check("personal event → no Redbloods context, meaning = availability only", [(personal.summary.find((x) => x.code === "REDBLOODS_CONTEXT")!.value as unknown[]).length, personal.items[0].fields.meaning], [0, "not linked to Redbloods — counts for the Owner's availability only"]);
  const pc = q(S, "context", { entity: `project:${P(2)}` });
  const rel = pc.summary.find((x) => x.code === "RELATED_EVENTS")!.value as Record<string, number>;
  check("project context: canonical + inferred + ambiguous kept apart", [rel.canonical, rel.inferred, rel.ambiguous], [1, 1, 1]);
  const occ = pc.summary.find((x) => x.code === "OWNER_OCCUPANCY_UNTIL_ANCHOR")!.value as Record<string, unknown>;
  ok("project context: occupancy until the deadline, from real calendar (personal time counted)", occ.to === "2026-09-30" && (occ.occupiedMinutes as number) > 0 && Array.isArray(occ.overlapDays));
  ok("project context: personal event is NOT attached to the project", !JSON.stringify(pc.items).includes("תור לרופא"));
  ok("project context coexists with project evidence (status / signals / money)", JSON.stringify(pc.summary.find((x) => x.code === "REDBLOODS_STATE")!.value).includes("signals"));
  const showc = q(S, "context", { entity: `show:${U(960)}` });
  check("show context: its canonical event", (showc.summary.find((x) => x.code === "RELATED_EVENTS")!.value as Record<string, number>).canonical, 1);
  const cc = q(S, "context", { entity: `client:${C_AVI}` });
  ok("client context: canonical meeting + show via stored ids", (cc.summary.find((x) => x.code === "RELATED_EVENTS")!.value as Record<string, number>).canonical >= 2);
  check("events filter holidays", q(S, "events", { filter: "holidays" }).items.map((i) => i.id).sort(), ["hol-sukkot", "hol-yk"]);
  check("events filter redbloods = canonical only", q(S, "events", { filter: "redbloods" }).items.map((i) => i.id).sort(), ["evt-meet", "evt-sess", "evt-show"]);
  const av = q(S, "availability", { from: "2026-09-25", to: "2026-09-25" });
  check("availability mode", [av.items[0].fields.status, (av.items[0].fields.free as unknown[]).length], ["KNOWN", 3]);
  check("provenance: canonical = FACT, inferred / personal = OBSERVATION", [q(S, "events", { filter: "redbloods" }).items.every((i) => i.epistemic === "FACT"), q(S, "events", { filter: "unlinked" }).items.every((i) => i.epistemic === "OBSERVATION")], [true, true]);
  const fail = q(src({ ...r, status: "CALENDAR_PROVIDER_ERROR", events: [], calendars: [], reasons: ["the Redbloods calendar service could not be reached"] }), "availability", { from: "2026-09-25", to: "2026-09-25" });
  check("provider failure → no items, UNKNOWN, missing says NOT empty", [fail.items.length, fail.completeness, fail.missing.some((m) => /NOT an empty calendar/.test(m.whyNeeded))], [0, "UNKNOWN", true]);
  const pq = q(src(part), "availability", { from: "2026-09-25", to: "2026-09-25" });
  check("partial read → PARTIAL completeness, no free time", [pq.completeness, pq.items[0].fields.free], ["PARTIAL", null]);
  check("Owner-only", q(S, "summary", {}, STRANGER).status === "OK", false);
  const enr = entityKnowledge(REG, { ...S, audience: OWNER }, `show:${U(960)}`);
  ok("partner_entity(show) is enriched with calendar context automatically", enr.some((x) => x.capability === "calendar"));

  section("7. project_view — canonical / inferred / general schedule context");
  const pv = queryKnowledgeCore(REG, { capability: "project_view", params: { project: `project:${P(2)}`, section: "calendar" }, limit: 50 }, S, OWNER);
  const kinds = pv.items.map((i) => i.fields.kind);
  ok("canonical + inferred + ambiguous live events and GENERAL_SCHEDULE_CONTEXT", ["LIVE_EVENT_CANONICAL", "LIVE_EVENT_INFERRED", "LIVE_EVENT_AMBIGUOUS", "GENERAL_SCHEDULE_CONTEXT"].every((k) => kinds.includes(k)));
  ok("unrelated personal events are not project facts", !JSON.stringify(pv.items).includes("תור לרופא") && !JSON.stringify(pv.items).includes("חדר כושר"));
  const pvDown = queryKnowledgeCore(REG, { capability: "project_view", params: { project: `project:${P(2)}`, section: "calendar" }, limit: 50 }, src("UNAVAILABLE"), OWNER);
  check("calendar down → project_view still COMPLETE for project data, calendar row says UNKNOWN", [pvDown.status, pvDown.items.some((i) => i.fields.kind === "LIVE_CALENDAR_STATUS" && i.epistemic === "UNKNOWN")], ["OK", true]);

  section("8. System Awareness + security + no write");
  const d = DOMAIN_CONTRACTS.find((x) => x.id === "GOOGLE_CALENDAR")!;
  ok("calendar domain = LIVE read, horizontal context rule, failure rule", d.support.read === "FULL" && d.rules.some((x) => x.id === "CALENDAR_HORIZONTAL_CONTEXT") && d.rules.some((x) => x.id === "CALENDAR_FAILURE_IS_NOT_EMPTY"));
  check("future calendar writes exist and are NOT_YET_EXECUTABLE", ["CREATE_CALENDAR_EVENT", "UPDATE_CALENDAR_EVENT", "DELETE_CALENDAR_EVENT", "SCHEDULE_SESSION", "SCHEDULE_MEETING", "RESCHEDULE_EVENT"].map((id) => { const a = BUSINESS_ACTIONS.find((x) => x.id === id)!; return [a.approval, a.sunnyCanExecuteToday, a.confirmations.includes("EXTERNAL_EFFECT_CONFIRMATION_REQUIRED")]; }), Array(6).fill(["NOT_EXECUTABLE_YET", false, true]));
  ok("known gaps registered: UTC week window + week route proxy-only", KNOWLEDGE_GAPS.some((g) => g.id === "CAL_WEEK_UTC_WINDOW") && SECURITY_GAPS.some((g) => g.id === "SG_CALENDAR_WEEK_ROUTE_PROXY_ONLY"));
  const cm = queryKnowledgeCore(REG, { capability: "system_awareness", mode: "calendar_model", limit: 50 }, S, OWNER);
  const served = JSON.stringify([cm, sum, evq, pc, pv, q(S, "events", { filter: "all" })]);
  check("forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((x) => served.toLowerCase().includes(x.toLowerCase())), []);
  check("planted secrets served", PLANTED.filter((s) => served.includes(s)), []);
  const calFiles = ["lib/partner/calendar/read-core.ts", "lib/partner/calendar/google-api.ts", "lib/partner/calendar/links.ts", "lib/partner/calendar/availability.ts", "lib/partner/calendar/sanitize.ts", "lib/partner/calendar/remote.ts", "lib/partner/calendar/internal-handler.ts", "lib/partner/knowledge/capabilities/calendar.ts", "app/api/partner/internal/calendar/route.ts"];
  check("no calendar write / business mutation anywhere in the new code", calFiles.filter((f) => /events\.(insert|update|patch|delete|move|quickAdd|import)|createCalendarEvent|updateCalendarEvent|deleteCalendarEvent|\.from\(["']|supabase/.test(code(read(f)))), []);
  ok("the new route is GET only", !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(read("app/api/partner/internal/calendar/route.ts")));
}

main().then(() => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1); });
