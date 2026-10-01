/**
 * Universal Action Layer — Sessions family: every primitive through the REAL service on fakes (6 standard checks each)
 * + family-specific checks (Shalev push disclosed, invite needs every guest in the approval, show rehearsals routed to
 * the Shows family, linked finance rows kept + previewed, vocabularies pinned, shared writer + hardening in the routes).
 * Run with:   npx tsx scripts/test-sunny-act-sessions.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { SESSION_PRIMITIVES, SESSION_STATUSES, SESSION_TYPES } from "../lib/partner/act/primitives/sessions";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

const seen: { lastCreate: { location?: string; invite: { emails: string[]; publicDescription?: string } | null } | null } = { lastCreate: null };
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type S = { projectId: string | null; showId: string | null; title: string; date: string | null; startTime: string | null; endTime: string | null; status: string; sessionType: string; notes: string; location: string; photographer: string; hasCalendarEvent: boolean };
interface W { sessions: Record<string, S>; projects: Record<string, { name: string; artist: string }>; tx: Record<string, number>; connected: boolean; invites: string[][] }
const world = (): W => ({
  sessions: {
    [U(1)]: { projectId: U(10), showId: null, title: "", date: "2026-10-01", startTime: "12:00", endTime: "15:00", status: "מתוכנן", sessionType: "סשן", notes: "", location: "", photographer: "", hasCalendarEvent: true },
    [U(2)]: { projectId: null, showId: U(90), title: "הופעה בחיפה", date: "2026-10-02", startTime: "18:00", endTime: "20:00", status: "מתוכנן", sessionType: "חזרה להופעה", notes: "", location: "", photographer: "", hasCalendarEvent: false },
  },
  projects: { [U(10)]: { name: "קרוב אלייך", artist: "שליו טסמה" }, [U(11)]: { name: "סינגל", artist: "נגש" } },
  tx: { [U(1)]: 1 }, connected: true, invites: [],
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readProjectMeta(id: string) { const p = w.projects[id]; return p ? { name: p.name, artist: p.artist, status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readSession(id: string) { return w.sessions[id] ? { ...w.sessions[id] } : null; },
    async countSessionTransactions(id: string) { return w.tx[id] ?? 0; },
    async isShalevProject(id: string) { return w.projects[id]?.artist === "שליו טסמה"; },
    async calendarConnected() { return w.connected; },
    async createSession(s: { projectId: string | null; title: string | null; date: string; startTime: string; endTime: string | null; status: string; sessionType: string; notes?: string; location?: string; photographer?: string; addToCalendar: boolean; invite: { emails: string[]; publicDescription?: string } | null }) {
      calls.push("createSession"); seen.lastCreate = s; const id = U(++n);
      w.sessions[id] = { projectId: s.projectId, showId: null, title: s.title ?? "", date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status, sessionType: s.sessionType, notes: s.notes ?? "", location: s.location ?? "", photographer: s.photographer ?? "", hasCalendarEvent: s.addToCalendar || !!s.invite };
      if (s.invite) w.invites.push(s.invite.emails);
      return { id, calendarError: null };
    },
    async updateSession(id: string, p: Record<string, unknown>) { calls.push("updateSession"); Object.assign(w.sessions[id], p); return { calendarSynced: true }; },
    async deleteSession(id: string) { calls.push("deleteSession"); delete w.sessions[id]; return { calendarDeleted: true }; },
  };
  return { w, calls, writers };
}
const S1 = `session:${U(1)}`, S2 = `session:${U(2)}`;
const CASES: FamilyCase<W>[] = [
  { id: "SCHEDULE_SESSION", args: { project: `project:${U(11)}`, date: "2026-10-05", startTime: "11:00", endTime: "14:00", addToCalendar: true }, confirm: "כן בוס, 2026-10-05 11:00", bad: { project: `project:${U(11)}`, date: "2026-10-05", startTime: "11" }, missing: { project: `project:${U(99)}`, date: "2026-10-05", startTime: "11:00" }, wrongKind: { project: S1, date: "2026-10-05", startTime: "11:00" }, stale: (w) => { w.connected = false; }, check: (w, c) => Object.values(w.sessions).some((s) => s.projectId === U(11) && s.date === "2026-10-05" && s.startTime === "11:00" && s.hasCalendarEvent) && c.join() === "createSession" },
  { id: "SCHEDULE_SESSION_WITH_INVITE", args: { project: `project:${U(11)}`, date: "2026-10-06", startTime: "10:00", endTime: "13:00", inviteEmails: "a@b.co", publicTitle: "סשן נגש ונגש ביטס" }, confirm: "כן בוס, 2026-10-06 10:00 a@b.co", bad: { project: `project:${U(11)}`, date: "2026-10-06", startTime: "10:00", inviteEmails: "nope", publicTitle: "x" }, missing: { project: `project:${U(99)}`, date: "2026-10-06", startTime: "10:00", inviteEmails: "a@b.co", publicTitle: "x" }, stale: (w) => { w.connected = false; }, check: (w) => w.invites.length === 1 && w.invites[0][0] === "a@b.co" },
  { id: "UPDATE_SESSION", args: { session: S1, date: "2026-10-03" }, confirm: "כן בוס, 2026-10-03", bad: { session: S1, status: "נקבע" }, missing: { session: `session:${U(9)}`, date: "2026-10-03" }, wrongKind: { session: `project:${U(10)}`, date: "2026-10-03" }, stale: (w) => { w.sessions[U(1)].startTime = "13:00"; }, check: (w) => w.sessions[U(1)].date === "2026-10-03" && w.sessions[U(1)].startTime === "12:00" },
  { id: "DELETE_SESSION", args: { session: S1 }, confirm: "כן בוס, מחיקה", bad: { session: "session:x" }, missing: { session: `session:${U(9)}` }, stale: (w) => { w.tx[U(1)] = 2; }, check: (w) => !w.sessions[U(1)] },
];

(async () => {
  console.log("Sessions family — standard checks");
  ok("the case table covers every Sessions primitive", CASES.map((c) => c.id).sort().join() === SESSION_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily-specific");
  const p1 = await planAction({ intentHe: "x", actionId: "SCHEDULE_SESSION", args: { project: `project:${U(10)}`, date: "2026-10-05", startTime: "11:00" } }, OWNER, mkDeps(mk().writers).d);
  ok("a session on a Shalev project discloses the Shalev + Owner push in the preview", p1.status === "PREVIEW" && JSON.stringify(p1).includes("Push 'נקבע סשן'"));
  const p2 = await planAction({ intentHe: "x", actionId: "SCHEDULE_SESSION", args: { date: "2026-10-05", startTime: "11:00", sessionType: "חזרה להופעה", title: "x" } }, OWNER, mkDeps(mk().writers).d);
  ok("a show rehearsal cannot be booked here (it has finance — Shows family)", p2.status === "USE_SHOW_ACTION");
  for (const id of ["UPDATE_SESSION", "DELETE_SESSION"]) {
    const r = await planAction({ intentHe: "x", actionId: id, args: id === "DELETE_SESSION" ? { session: S2 } : { session: S2, date: "2026-10-09" } }, OWNER, mkDeps(mk().writers).d);
    ok(`${id} on a show rehearsal is routed to the Shows family`, r.status === "USE_SHOW_ACTION", r.status);
  }
  const p3 = await planAction({ intentHe: "x", actionId: "SCHEDULE_SESSION", args: { date: "2026-10-05", startTime: "11:00" } }, OWNER, mkDeps(mk().writers).d);
  ok("a session needs a project or a standalone title", p3.status === "MISSING_TARGET");
  const nc = mk(); nc.w.connected = false;
  const p4 = await planAction({ intentHe: "x", actionId: "SCHEDULE_SESSION", args: { title: "x", date: "2026-10-05", startTime: "11:00", addToCalendar: true } }, OWNER, mkDeps(nc.writers).d);
  ok("asking for a calendar event while Google is disconnected is refused (never a silent 'done')", p4.status === "NOT_CONNECTED");
  const p5 = await planAction({ intentHe: "x", actionId: "SCHEDULE_SESSION", args: { title: "x", date: "2026-10-05", startTime: "11:00" } }, OWNER, mkDeps(nc.writers).d);
  ok("without a calendar request a disconnected Google does not block the booking", p5.status === "PREVIEW");
  const iv = mk(); const ri = await fullFlow(mkDeps(iv.writers).d, "SCHEDULE_SESSION_WITH_INVITE", { project: `project:${U(11)}`, date: "2026-10-06", startTime: "10:00", inviteEmails: "a@b.co, c@d.co", publicTitle: "x" }, "מאשר אבל בלי c@d.co");
  ok("\"מאשר אבל בלי …\" on an invite is a change → nothing sent", ri.a?.status === "APPROVAL_WITH_CHANGES" && iv.calls.length === 0, ri.a?.status);
  ok("SCHEDULE_SESSION_WITH_INVITE is external communication (EMAIL) with C3", ACTION_REGISTRY.get("SCHEDULE_SESSION_WITH_INVITE")!.effects.includes("EMAIL" as never) && ACTION_REGISTRY.get("SCHEDULE_SESSION_WITH_INVITE")!.confirmation !== "C1_APPROVAL");
  // the בלאגן shoot (2026-10-01): the place, notes and public description are SHOWN before approval and reach the writer
  const loc = mk(); const rl = await fullFlow(mkDeps(loc.writers).d, "SCHEDULE_SESSION_WITH_INVITE", { project: `project:${U(11)}`, date: "2026-10-04", startTime: "16:00", endTime: "21:00", sessionType: "צילום קליפ", location: "יער בן שמן", notes: "להביא תאורה", publicDescription: "צילום הקליפ — נפגשים בחניה", inviteEmails: "a@b.co", publicTitle: "צילום קליפ – בלאגן 🎬" }, "מאשר");
  const lp = JSON.stringify(rl.p);
  ok("invite preview shows location / notes / publicDescription (not only date / time)", /יער בן שמן/.test(lp) && /להביא תאורה/.test(lp) && /נפגשים בחניה/.test(lp), rl.p);
  ok("executed: the writer receives the place + the public description; the stored session has the place (exact verify)", rl.e?.status === "APPLIED_AS_EXPECTED" && seen.lastCreate?.location === "יער בן שמן" && seen.lastCreate?.invite?.publicDescription === "צילום הקליפ — נפגשים בחניה", rl.e ?? rl.p);
  ok("the Google event gets the session's place on create (invite + plain paths) and on a real place change", /location: place \}\)/.test(read("lib/writes/sessions.ts")) && /\.\.\.\(place \? \{ location: place \} : \{\}\)/.test(read("lib/writes/sessions.ts")) && /if \(placeChanged\) upd\.location = /.test(read("lib/writes/sessions.ts")) && /location:\s+opts\?\.location \|\| undefined/.test(read("lib/google-calendar.ts")));
  const pd = await planAction({ intentHe: "x", actionId: "DELETE_SESSION", args: { session: S1 } }, OWNER, mkDeps(mk().writers).d);
  ok("deleting a session with a linked finance row says the row is kept", pd.status === "PREVIEW" && JSON.stringify(pd).includes("רשומות כספים מקושרות לסשן — הן נשארות"));

  console.log("\nVocabularies pinned to the code");
  const dr = read("components/ui/ProjectDrawer.tsx");
  ok("session statuses = ProjectDrawer STATUS_OPTIONS", dr.includes(`STATUS_OPTIONS:   SessionStatus[]   = [${SESSION_STATUSES.map((x) => `"${x}"`).join(", ")}]`));
  ok("session types = ProjectDrawer TYPE_OPTIONS", dr.includes(`TYPE_OPTIONS:     SessionType[]     = [${SESSION_TYPES.map((x) => `"${x}"`).join(", ")}]`));

  console.log("\nShared writer (no divergence) + hardening");
  ok("the session routes use the shared writer (create / update / delete)", /createSession\(/.test(read("app/api/sessions/route.ts")) && /updateSession\(/.test(read("app/api/sessions/[id]/route.ts")) && /deleteSession\(/.test(read("app/api/sessions/[id]/route.ts")));
  const sw = read("lib/writes/sessions.ts");
  ok("HARDENED: a date / time edit moves the Google event even without absolute times (only the calendar pull's own copy-back skips the echo — A3)", /if \(!fromCalendar && moved && !startIso && !endIso && row\.date && row\.start_time\)/.test(sw) && /const fromCalendar = opts\.origin === "CALENDAR_PULL";/.test(sw));
  ok("the Shalev push stays in the same writer (production-guarded inside lib/session-notify)", /notifySessionCreatedForShalev\(/.test(sw) && /NODE_ENV === "production"/.test(read("lib/session-notify.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
