/**
 * A3 — SESSIONS: time passed ≠ session happened (Owner canon, 2026-09-27).
 *   • no page-load / background clock writer: the auto-mark route + AppShell effect + the drawer's local auto-mark are gone;
 *   • a passed, unconfirmed מתוכנן session stays מתוכנן and reads "עבר — לא אושר" (display only, never counted as held);
 *   • the end is overnight-aware (sessionEndLocal) — the same rule for the calendar, the badge, the reports and the pull;
 *   • the calendar pull moves date / times through the shared writer, never changes a status (reports statusConflicts),
 *     never touches a show rehearsal's status, and tells a Google API error apart from a missing event.
 * The real calendar-pull route runs on stubbed Supabase / Google modules (no network, no DB).
 * Run with:   npx tsx scripts/test-sessions-no-auto-happened.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  sessionEndLocal, isPastUnconfirmed, sessionEndPassed, PAST_UNCONFIRMED_LABEL, AUTO_MARK_RETIRED_AT, heldIsLegacyPossiblyAutoMarked,
} from "../lib/session-duration";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(p, "utf8");

// ── stubs ────────────────────────────────────────────────────────────────────
type Row = { id: string; project_id: string | null; date: string | null; start_time: string | null; end_time: string | null; status: string; session_type: string; show_id: string | null; calendar_event_id: string | null; cost: number | null };
let rows: Row[] = [];
const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
const calls: string[] = [];
const sessionsTable = () => {
  const f: Array<(r: Row) => boolean> = [];
  let patch: Record<string, unknown> | null = null;
  const q = {
    select() { return q; },
    eq(c: keyof Row, v: unknown) { f.push((r) => r[c] === v); return q; },
    not(c: keyof Row, _op: string, _v: null) { f.push((r) => r[c] !== null && r[c] !== undefined); return q; },
    update(p: Record<string, unknown>) { patch = p; return q; },
    async single() {
      const hit = rows.filter((r) => f.every((x) => x(r)));
      if (patch && hit[0]) { writes.push({ id: hit[0].id, patch: { ...patch } }); Object.assign(hit[0], patch); }
      return { data: hit[0] ? { ...hit[0] } : null, error: hit[0] ? null : { message: "not found" } };
    },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows.filter((r) => f.every((x) => x(r))).map((r) => ({ ...r })), error: null }).then(res); },
  };
  return q;
};
const fakeSupabase = { from(t: string) { if (t !== "sessions") throw new Error(`unexpected table ${t}`); return sessionsTable(); } };
type EvRes = { kind: "FOUND"; event: { status: string; date: string | null; startTime: string | null; endTime: string | null } } | { kind: "MISSING"; reason: "NOT_FOUND" | "CANCELLED" } | { kind: "ERROR"; error: string };
let events: Record<string, EvRes> = {};
const fakeCalendar = {
  isConnected: async () => true,
  getCalendarEventResult: async (id: string) => events[id] ?? { kind: "MISSING", reason: "NOT_FOUND" },
  calendarEventExists: async () => { calls.push("calendarEventExists"); return true; },
  updateCalendarEvent: async () => { calls.push("updateCalendarEvent"); },
};
/** matches "@/lib/x", "../lib/x" and a resolved absolute path "…\lib\x.ts" (dynamic imports) */
const isMod = (request: string, name: string) => request.replace(/\\/g, "/").replace(/\.ts$/, "").endsWith(`lib/${name}`);
// Dynamic `await import("@/lib/…")` inside the route / writers goes through the ESM loader (Module._load's return
// value is not used for named exports there), so those modules are replaced with in-memory ESM stubs via
// module.registerHooks (Node ≥ 22.15) that re-export the fakes held on globalThis.
const fakeShowsStore = { getShow: async (id: string) => ({ id }) };
const fakeShowsSync = { syncRehearsalFinance: async (s: { id: string; date: string | null }) => { calls.push(`syncRehearsalFinance:${s.id}:${s.date}`); }, syncShowFinance: async () => { calls.push("syncShowFinance"); } };
const ESM_FAKES: Record<string, object> = { "google-calendar": fakeCalendar, "shows-store": fakeShowsStore, "shows-finance-sync": fakeShowsSync };
(globalThis as unknown as { __a3Fakes: Record<string, object> }).__a3Fakes = ESM_FAKES;
(Module as unknown as { registerHooks(h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown; load: (u: string, c: unknown, n: (u: string, c: unknown) => unknown) => unknown }): void }).registerHooks({
  resolve(spec, ctx, next) {
    const hit = Object.keys(ESM_FAKES).find((n) => isMod(spec, n));
    return hit ? { url: `a3-fake:${hit}`, shortCircuit: true } : next(spec, ctx);
  },
  load(url, ctx, next) {
    if (!url.startsWith("a3-fake:")) return next(url, ctx);
    const name = url.slice("a3-fake:".length);
    const src = Object.keys(ESM_FAKES[name]).map((k) => `export const ${k} = globalThis.__a3Fakes[${JSON.stringify(name)}].${k};`).join("\n");
    return { format: "module", source: src, shortCircuit: true };
  },
});
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@supabase/supabase-js") return { createClient: () => fakeSupabase };
  if (isMod(request, "supabase")) return { supabase: fakeSupabase };
  if (isMod(request, "google-calendar")) return fakeCalendar;
  if (isMod(request, "projects-store")) return { touchProject: async () => { calls.push("touchProject"); }, ensureProjectStartDate: async () => { calls.push("ensureProjectStartDate"); } };
  if (isMod(request, "session-notify")) return { notifySessionCreatedForShalev: async () => { calls.push("push"); } };
  if (isMod(request, "shows-store")) return { getShow: async (id: string) => ({ id }) };
  if (isMod(request, "shows-finance-sync")) return { syncRehearsalFinance: async (s: { id: string; date: string | null }) => { calls.push(`syncRehearsalFinance:${s.id}:${s.date}`); }, syncShowFinance: async () => { calls.push("syncShowFinance"); } };
  return orig.call(this, request, parent, isMain);
};

(async () => {
  console.log("1. The shared end rule (sessionEndLocal) — overnight-aware, pure");
  ok("normal session: end = same day", sessionEndLocal("2026-09-20", "12:00", "14:00") === "2026-09-20T14:00:00");
  ok("overnight 22:00–02:00 ends the NEXT day at 02:00", sessionEndLocal("2026-09-26", "22:00", "02:00") === "2026-09-27T02:00:00");
  ok("an end equal to the start is the next day", sessionEndLocal("2026-09-26", "10:00", "10:00") === "2026-09-27T10:00:00");
  ok("no end → start + 1h", sessionEndLocal("2026-09-20", "12:30", null) === "2026-09-20T13:30:00");
  ok("no end at 23:30 → 00:30 the next day", sessionEndLocal("2026-09-30", "23:30", null) === "2026-10-01T00:30:00");
  ok("tolerates HH:MM:SS input", sessionEndLocal("2026-09-20", "12:00:00", "14:15:00") === "2026-09-20T14:15:00");
  ok("no date → null; no times → null", sessionEndLocal(null, "12:00", "13:00") === null && sessionEndLocal("2026-09-20", null, null) === null);
  ok("month / year roll-over", sessionEndLocal("2026-12-31", "23:00", "01:00") === "2027-01-01T01:00:00");

  console.log("\n2. Passed ≠ happened — the display-only 'עבר — לא אושר'");
  const now = "2026-09-27T12:00:00";
  const planned = (date: string, s: string | null, e: string | null) => ({ status: "מתוכנן", date, start_time: s, end_time: e });
  ok("the label is exactly 'עבר — לא אושר'", PAST_UNCONFIRMED_LABEL === "עבר — לא אושר");
  ok("a future planned session is not past-unconfirmed", !isPastUnconfirmed(planned("2026-09-28", "12:00", "14:00"), now));
  ok("a session later today (not ended) is not past-unconfirmed", !isPastUnconfirmed(planned("2026-09-27", "11:00", "13:00"), now));
  ok("a past unconfirmed session stays מתוכנן and reads 'עבר — לא אושר'", isPastUnconfirmed(planned("2026-09-20", "12:00", "14:00"), now));
  ok("a confirmed (התקיים) session is not flagged", !isPastUnconfirmed({ status: "התקיים", date: "2026-09-20", start_time: "12:00", end_time: "14:00" }, now));
  ok("cancelled / postponed / no-show are recorded outcomes, not flagged", ["בוטל", "נדחה", "לא הגיע"].every((st) => !isPastUnconfirmed({ status: st, date: "2026-09-20", start_time: "12:00", end_time: "14:00" }, now)));
  ok("overnight 22:00–02:00 on 09-26 is NOT ended at 23:30 the same evening (the old rule said it was)", !sessionEndPassed({ date: "2026-09-26", start_time: "22:00", end_time: "02:00" }, "2026-09-26T23:30:00") && "2026-09-26T02:00:00" < "2026-09-26T23:30:00");
  ok("overnight: not ended at 01:59 the next day, ended at 02:01", !sessionEndPassed({ date: "2026-09-26", start_time: "22:00", end_time: "02:00" }, "2026-09-27T01:59:00") && sessionEndPassed({ date: "2026-09-26", start_time: "22:00", end_time: "02:00" }, "2026-09-27T02:01:00"));
  ok("legacy vs explicit התקיים splits at AUTO_MARK_RETIRED_AT", AUTO_MARK_RETIRED_AT === "2026-09-27" && heldIsLegacyPossiblyAutoMarked({ status: "התקיים", date: "2026-09-20", start_time: "12:00", end_time: "14:00" }) && !heldIsLegacyPossiblyAutoMarked({ status: "התקיים", date: "2026-10-02", start_time: "12:00", end_time: "14:00" }) && !heldIsLegacyPossiblyAutoMarked({ status: "מתוכנן", date: "2026-09-20", start_time: null, end_time: null }));

  console.log("\n3. Google Calendar times unchanged for normal sessions (sessionCalendarTimes)");
  const { sessionCalendarTimes } = await import("../lib/writes/sessions");
  // the pre-A3 implementation, verbatim, for comparison
  const addDayStr = (d: string) => { const [y, m, dd] = d.split("-").map(Number); const nd = new Date(Date.UTC(y, m - 1, dd) + 86400000); return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`; };
  const legacy = (date: string, startTime: string, endTime?: string | null) => {
    const calStart = `${date}T${startTime}:00`;
    if (endTime) { const [sH, sM] = startTime.split(":").map(Number); const [eH, eM] = endTime.split(":").map(Number); const endDate = eH * 60 + eM <= sH * 60 + sM ? addDayStr(date) : date; return { start: calStart, end: `${endDate}T${endTime}:00` }; }
    const [hh, mm] = startTime.split(":").map(Number); const t = hh * 60 + mm + 60;
    return { start: calStart, end: `${date}T${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}:00` };
  };
  const cases: Array<[string, string, string | null]> = [["2026-09-20", "12:00", "14:00"], ["2026-09-20", "09:30", "18:45"], ["2026-09-26", "22:00", "02:00"], ["2026-12-31", "23:00", "01:00"], ["2026-09-20", "10:00", "10:00"], ["2026-09-20", "12:00", null], ["2026-09-20", "18:15", null], ["2026-09-20", "22:30", null]];
  const diffs = cases.filter(([d, s, e]) => JSON.stringify(sessionCalendarTimes(d, s, e)) !== JSON.stringify(legacy(d, s, e)));
  ok("identical start / end for every normal case (timed, overnight, no end before 23:00)", diffs.length === 0, diffs.map(([d, s, e]) => ({ d, s, e, now: sessionCalendarTimes(d, s, e), was: legacy(d, s, e) })));
  ok("the one fix: a no-end session starting 23:30 now ends the next day (it used to end before it started)", sessionCalendarTimes("2026-09-20", "23:30", null).end === "2026-09-21T00:30:00" && legacy("2026-09-20", "23:30", null).end === "2026-09-20T00:30:00");

  console.log("\n4. The calendar pull (real route, stubbed Supabase + Google)");
  process.env.CRON_SECRET = "cron-test";
  const R = (id: string, o: Partial<Row>): Row => ({ id, project_id: "p1", date: "2026-09-20", start_time: "12:00", end_time: "14:00", status: "מתוכנן", session_type: "סשן", show_id: null, calendar_event_id: `ev-${id}`, cost: null, ...o });
  rows = [
    R("moved", {}),
    R("held-future", { status: "התקיים" }),
    R("rehearsal", { status: "התקיים", session_type: "חזרה להופעה", show_id: "show-1", project_id: null, cost: 200 }),
    R("err", {}),
    R("gone", {}),
    R("allday", { start_time: "12:00:00", end_time: "14:00:00" }),
    R("same", { start_time: "12:00:00", end_time: "14:00:00" }),
  ];
  const T = (date: string, s: string, e: string | null): EvRes => ({ kind: "FOUND", event: { status: "confirmed", date, startTime: s, endTime: e } });
  events = {
    "ev-moved": T("2026-09-22", "15:00", "17:00"),
    "ev-held-future": T("2099-01-01", "10:00", "12:00"),
    "ev-rehearsal": T("2099-01-02", "20:00", "22:00"),
    "ev-err": { kind: "ERROR", error: "google_http_500" },
    "ev-gone": { kind: "MISSING", reason: "NOT_FOUND" },
    "ev-allday": { kind: "FOUND", event: { status: "confirmed", date: "2026-09-20", startTime: null, endTime: null } },
    "ev-same": T("2026-09-20", "12:00", "14:00"),
  };
  const { GET } = await import("../app/api/sessions/calendar-pull/route");
  const res = await GET(new NextRequest("https://app.test/api/sessions/calendar-pull?secret=cron-test&all=1"));
  const body = await res.json() as { ok: boolean; updated: number; unchanged: number; missing: string[]; calendarErrors: Array<{ id: string }>; errors: unknown[]; updatedItems: Array<{ sessionId: string; changedFields: string[] }>; statusConflicts: Array<{ sessionId: string }> };
  const row = (id: string) => rows.find((r) => r.id === id)!;
  ok("a moved event moves the session's date / start / end", row("moved").date === "2026-09-22" && row("moved").start_time === "15:00" && row("moved").end_time === "17:00" && row("moved").status === "מתוכנן", row("moved"));
  ok("NO status is ever written by the pull", writes.every((w) => !("status" in w.patch)), writes);
  ok("a held session whose event moved to the future keeps התקיים and is reported in statusConflicts", row("held-future").status === "התקיים" && body.statusConflicts.some((c) => c.sessionId === "held-future"), body.statusConflicts);
  ok("a show rehearsal's status is never touched (and never reported as a conflict)", row("rehearsal").status === "התקיים" && !body.statusConflicts.some((c) => c.sessionId === "rehearsal"));
  ok("a moved show rehearsal still re-syncs its finance (the shared writer)", calls.includes("syncRehearsalFinance:rehearsal:2099-01-02"), calls);
  ok("a Google API error is an ERROR, never 'missing'", body.calendarErrors.some((e) => e.id === "err") && !body.missing.includes("err") && row("err").date === "2026-09-20");
  ok("a missing event is reported in missing (the session is kept)", body.missing.includes("gone") && !!row("gone"));
  ok("an all-day event never wipes the session's times", row("allday").start_time === "12:00:00" && row("allday").end_time === "14:00:00");
  ok("HH:MM:SS in the DB vs HH:MM in Google is not a change", !writes.some((w) => w.id === "same"));
  ok("counts: 3 updated, 2 unchanged", body.updated === 3 && body.unchanged === 2, body);
  ok("no echo write back to Google and no project touch (origin CALENDAR_PULL)", !calls.includes("updateCalendarEvent") && !calls.includes("calendarEventExists") && !calls.includes("touchProject"), calls);
  ok("never sends a push", !calls.includes("push"));
  const pullSrc = read("app/api/sessions/calendar-pull/route.ts");
  ok("the pull writes only through updateSession(…, { origin: \"CALENDAR_PULL\" })", /updateSession\(sessionId, patch, \{ origin: "CALENDAR_PULL" \}\)/.test(pullSrc) && !/\.update\(/.test(pullSrc));
  const gcal = read("lib/google-calendar.ts");
  ok("google-calendar: getCalendarEventResult separates MISSING (404 / 410 / cancelled) from ERROR; getCalendarEvent keeps its legacy shape", /export async function getCalendarEventResult/.test(gcal) && /st === 404 \|\| st === 410/.test(gcal) && /kind: "ERROR"/.test(gcal) && /export async function getCalendarEvent\(/.test(gcal));

  console.log("\n5. No page-load / background clock writer (static)");
  ok("the auto-mark route is gone", !fs.existsSync("app/api/sessions/auto-mark"));
  const shell = read("components/AppShell.tsx");
  ok("AppShell has no auto-mark effect", !/sessions\/auto-mark/.test(shell) && !/clientNow/.test(shell));
  const drawer = read("components/ui/ProjectDrawer.tsx");
  ok("ProjectDrawer has no local auto-mark and no page-load start-date PATCH", !/localAutoMark/.test(drawer) && !/startDate: earliest/.test(drawer));
  ok("ProjectDrawer / V2 / ClientDrawer show the 'עבר — לא אושר' badge via the shared rule", ["components/ui/ProjectDrawer.tsx", "components/ui/ProjectDrawerV2.tsx", "components/clients/ClientDrawer.tsx"].every((f) => /isPastUnconfirmed\(s, localNowString\(\)\)/.test(read(f)) && /PAST_UNCONFIRMED_LABEL/.test(read(f))));
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
  walk("components");
  const effectBodies = (src: string): string[] => {
    const out: string[] = [];
    let i = 0;
    while ((i = src.indexOf("useEffect(", i)) !== -1) {
      let depth = 0, j = i + "useEffect".length;
      for (; j < src.length; j++) { const ch = src[j]; if (ch === "(") depth++; else if (ch === ")") { depth--; if (depth === 0) break; } }
      out.push(src.slice(i, j + 1)); i = j + 1;
    }
    return out;
  };
  const offenders = files.flatMap((f) => effectBodies(read(f)).filter((b) => /\/api\/sessions/.test(b) && /method:\s*["'](POST|PATCH|PUT)["']/.test(b)).map(() => f));
  ok("no component useEffect POSTs / PATCHes a session (static scan of components/**)", offenders.length === 0, offenders);
  ok("the drawer's session loader writes nothing (fetchSessions has no PATCH / POST)", (() => { const a = drawer.indexOf("const fetchSessions"); const b = drawer.indexOf("useEffect(", a); const body = drawer.slice(a, b); return a > 0 && !/method:\s*"(PATCH|POST)"/.test(body); })());
  const bg = read("lib/partner/act/background.ts");
  ok("the background-writer inventory no longer lists SESSION_AUTO_MARK", !/SESSION_AUTO_MARK/.test(bg));

  console.log("\n6. Readers use the real vocabulary + the end rule");
  for (const f of ["lib/reports/data.ts", "lib/reports/weekly.ts", "lib/agent/snapshot.ts", "lib/agent/rules.ts"]) {
    const src = read(f);
    ok(`${f}: no נקבע / הושלם session status; need-update uses sessionEndLocal on מתוכנן`, !/status\s*[!=]==\s*"נקבע"/.test(src) && !/"הושלם" \|\| s\.status/.test(src) && /sessionEndLocal\(/.test(src) && /"מתוכנן"/.test(src));
  }
  ok("lib/agent/goals.ts counts התקיים / בוצע", /\["התקיים", "בוצע"\]/.test(read("lib/agent/goals.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
