/**
 * Session AUTO MARK — reinstated SERVER-SIDE (Owner decision 2026-10-01). Proves, on a fake that applies the UPDATE's
 * WHERE at write time exactly like Postgres:
 *   • the rule: status מתוכנן + type סשן / ניקוי מיקס / צילום קליפ + no show link + the real end passed (Israel clock,
 *     overnight-aware, DST) → התקיים / AUTO_MARK / status_changed_at; status_source never blocks it;
 *   • never a show rehearsal / a rehearsal / a show-linked row (D6); never בוטל / נדחה / לא הגיע / התקיים;
 *   • a status the Owner sets between the read and the write is never overwritten (guarded, atomic); idempotent;
 *   • server-only: a gated cron in instrumentation.ts, no page-load writer, no push / calendar / finance;
 *   • Sunny tells AUTO_MARK (time passed, not the Owner's confirmation) from MANUAL (the Owner's record) and legacy.
 * Run with:   npx tsx scripts/test-sessions-auto-mark.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { autoMarkEligible, heldMeaning, heldConfirmedByOwner, israelNowString, AUTO_MARK_SESSION_TYPES } from "../lib/session-duration";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// the writer module imports server-only / supabase / the push + project helpers — stub them (the auto-mark gets its client injected)
import Module from "node:module";
const pushCalls: string[] = [];
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from() { throw new Error("the real client is never used in this test"); } } };
  if (/session-notify$/.test(request)) return { notifySessionCreatedForShalev: async () => { pushCalls.push("push"); } };
  if (/projects-store$/.test(request)) return { touchProject: async () => undefined, ensureProjectStartDate: async () => undefined };
  return origLoad.call(this, request, parent, isMain);
};

type Row = { id: string; status: string; session_type: string; show_id: string | null; date: string; start_time: string; end_time: string; status_source: string | null; status_changed_at: string | null };
/** A fake of the two queries autoMarkPassedSessions makes; `between` runs after the read and before the write (a concurrent edit). */
function fakeDb(rows: Row[], between?: (rows: Row[]) => void) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    rows, writes,
    from() {
      return {
        select() { return { eq: async (_c: string, v: string) => ({ data: rows.filter((r) => r.status === v).map((r) => ({ ...r })), error: null }) }; },
        update(patch: Record<string, unknown>) {
          return { in: (_c: string, ids: string[]) => ({ eq: (_c2: string, st: string) => ({ in: (_c3: string, types: readonly string[]) => ({ is: (_c4: string, _n: null) => ({ select: async () => {
            between?.(rows);
            // the WHERE is evaluated NOW, on the current rows (Postgres semantics)
            const hit = rows.filter((r) => ids.includes(r.id) && r.status === st && types.includes(r.session_type) && r.show_id === null);
            for (const r of hit) Object.assign(r, patch);
            writes.push({ patch, ids: hit.map((r) => r.id) });
            return { data: hit.map((r) => ({ id: r.id })), error: null };
          } }) }) }) }) };
        },
      };
    },
  };
}
const R = (id: string, o: Partial<Row> = {}): Row => ({ id, status: "מתוכנן", session_type: "סשן", show_id: null, date: "2026-09-28", start_time: "11:00", end_time: "13:00", status_source: null, status_changed_at: null, ...o });

(async () => {
  const { autoMarkPassedSessions } = await import("../lib/writes/sessions");

  console.log("The rule (pure)");
  const night = { status: "מתוכנן", session_type: "סשן", show_id: null, date: "2026-10-01", start_time: "22:00", end_time: "02:00" };
  ok("overnight 22:00–02:00 is NOT passed at 23:30 or 01:59 (next day)", !autoMarkEligible(night, "2026-10-01T23:30:00") && !autoMarkEligible(night, "2026-10-02T01:59:00"));
  ok("overnight 22:00–02:00 IS passed at 02:01 the next day", autoMarkEligible(night, "2026-10-02T02:01:00"));
  ok("allowed types exactly: סשן / ניקוי מיקס / צילום קליפ", JSON.stringify(AUTO_MARK_SESSION_TYPES) === JSON.stringify(["סשן", "ניקוי מיקס", "צילום קליפ"]));
  ok("never a show rehearsal / a rehearsal / a show-linked session (D6)", !autoMarkEligible({ ...night, session_type: "חזרה להופעה" }, "2026-10-03T00:00:00") && !autoMarkEligible({ ...night, session_type: "חזרה" }, "2026-10-03T00:00:00") && !autoMarkEligible({ ...night, show_id: "x" }, "2026-10-03T00:00:00"));
  ok("never a status other than מתוכנן (בוטל / נדחה / לא הגיע / התקיים / בוצע)", ["בוטל", "נדחה", "לא הגיע", "התקיים", "בוצע"].every((st) => !autoMarkEligible({ ...night, status: st }, "2026-10-03T00:00:00")));
  ok("Israel clock, DST-aware: 2026-10-26 (winter, UTC+2) 08:01Z = 10:01 IL; 2026-09-28 (summer, UTC+3) 10:01Z = 13:01 IL", israelNowString(new Date("2026-10-26T08:01:00Z")) === "2026-10-26T10:01:00" && israelNowString(new Date("2026-09-28T10:01:00Z")) === "2026-09-28T13:01:00");

  console.log("\nThe guarded writer (fake = Postgres WHERE at write time)");
  const now = new Date("2026-10-01T12:00:00Z"); // 15:00 Israel
  const db = fakeDb([
    R("past-a"), R("past-b", { date: "2026-09-30", start_time: "10:30", end_time: "13:00" }),
    R("manual-planned", { status_source: "MANUAL", date: "2026-09-29" }),
    R("mix", { session_type: "ניקוי מיקס", date: "2026-09-29" }), R("clip", { session_type: "צילום קליפ", date: "2026-09-29" }),
    R("future", { date: "2026-10-01", start_time: "19:00", end_time: "22:00" }),
    R("overnight-not-yet", { date: "2026-10-01", start_time: "14:00", end_time: "01:00" }),
    R("show-rehearsal", { session_type: "חזרה להופעה", show_id: "show-1" }), R("rehearsal", { session_type: "חזרה" }), R("show-linked", { show_id: "show-2" }),
    R("cancelled", { status: "בוטל" }), R("postponed", { status: "נדחה" }), R("noshow", { status: "לא הגיע" }), R("held-manual", { status: "התקיים", status_source: "MANUAL" }),
  ]);
  const r1 = await autoMarkPassedSessions(now, db as never);
  const st = (id: string) => db.rows.find((r) => r.id === id)!;
  ok("marks every eligible passed session (סשן ×2, ניקוי מיקס, צילום קליפ, and a planned one the Owner once touched — MANUAL never blocks)", JSON.stringify([...r1.marked].sort()) === JSON.stringify(["clip", "manual-planned", "mix", "past-a", "past-b"]), r1);
  ok("…to התקיים with status_source AUTO_MARK and status_changed_at = the tick", ["past-a", "past-b", "mix", "clip", "manual-planned"].every((id) => st(id).status === "התקיים" && st(id).status_source === "AUTO_MARK" && st(id).status_changed_at === now.toISOString()));
  ok("the future session and an overnight one that has not ended are untouched", st("future").status === "מתוכנן" && st("overnight-not-yet").status === "מתוכנן");
  ok("show rehearsal / rehearsal / show-linked rows untouched (D6)", ["show-rehearsal", "rehearsal", "show-linked"].every((id) => st(id).status === "מתוכנן" && st(id).status_source === null));
  ok("בוטל / נדחה / לא הגיע / a manual התקיים are never overwritten", st("cancelled").status === "בוטל" && st("postponed").status === "נדחה" && st("noshow").status === "לא הגיע" && st("held-manual").status_source === "MANUAL");
  const r2 = await autoMarkPassedSessions(now, db as never);
  ok("idempotent: a second tick marks nothing", r2.marked.length === 0 && r2.candidates === 0);
  ok("no push was sent by any tick", pushCalls.length === 0);

  const race = fakeDb([R("race-a"), R("race-b")], (rows) => { Object.assign(rows.find((r) => r.id === "race-a")!, { status: "בוטל", status_source: "MANUAL" }); });
  const r3 = await autoMarkPassedSessions(now, race as never);
  ok("concurrency: the Owner cancels between the read and the write → his בוטל stays; only the other is marked", r3.candidates === 2 && JSON.stringify(r3.marked) === JSON.stringify(["race-b"]) && race.rows[0].status === "בוטל" && race.rows[0].status_source === "MANUAL", { r3, rows: race.rows });
  const race2 = fakeDb([R("race-c")], (rows) => { Object.assign(rows[0], { status: "התקיים", status_source: "MANUAL" }); });
  const r4 = await autoMarkPassedSessions(now, race2 as never);
  ok("concurrency: the Owner marks it התקיים himself meanwhile → his MANUAL stays (not re-labelled AUTO_MARK)", r4.marked.length === 0 && race2.rows[0].status_source === "MANUAL");

  console.log("\nServer-only, no side effects");
  const ins = read("instrumentation.ts");
  ok("a MAIN cron every 5 minutes, gated by SESSION_AUTO_MARK_ENABLED, calling the shared writer", /if \(process\.env\.SESSION_AUTO_MARK_ENABLED === "true"\) \{\s*cron\.schedule\("\*\/5 \* \* \* \*"/.test(ins) && ins.includes("autoMarkPassedSessions(new Date())"));
  const w = read("lib/writes/sessions.ts");
  const body = w.slice(w.indexOf("export async function autoMarkPassedSessions"));
  ok("the auto-mark writes only sessions: no push / notify / calendar / finance / transactions", !/push|notify|calendar|google|transactions|syncRehearsalFinance|syncShowFinance/i.test(body.replace(/\/\/.*$/gm, "")));
  ok("the UPDATE re-checks status = מתוכנן, the type and no show at write time", /\.in\("id", due\)\.eq\("status", "מתוכנן"\)\.in\("session_type", AUTO_MARK_SESSION_TYPES\)\.is\("show_id", null\)/.test(body));
  ok("no page-load writer: AppShell / ProjectDrawer / pages never call the auto-mark", !/autoMarkPassedSessions|sessions\/auto-mark/.test(read("components/AppShell.tsx") + read("components/ui/ProjectDrawer.tsx")) && !fs.existsSync(path.join(ROOT, "app/api/sessions/auto-mark")));
  ok("create records CREATED (or MANUAL when created in another status); a REAL status change records MANUAL; re-sending the same status keeps the source", w.includes('status_source: !status || status === "מתוכנן" ? "CREATED" : "MANUAL"') && /if \(\(cur as \{ status\?: string \} \| null\)\?\.status !== status\) \{ patch\.status_source = "MANUAL"/.test(w));

  console.log("\nSunny: AUTO_MARK ≠ the Owner's confirmation");
  const base = { status: "התקיים", date: "2026-10-01", start_time: "11:00", end_time: "13:00" };
  ok("heldMeaning: AUTO_MARK / MANUAL / legacy (no source, ≤ 27.09) / A3 era (no source, after)", heldMeaning({ ...base, status_source: "AUTO_MARK" }) === "AUTO_MARK" && heldMeaning({ ...base, status_source: "MANUAL" }) === "MANUAL" && heldMeaning({ ...base, status_source: null, date: "2026-09-20" }) === "LEGACY_POSSIBLY_AUTO" && heldMeaning({ ...base, status_source: null, date: "2026-09-29" }) === "MANUAL_A3_ERA");
  ok("only MANUAL / the A3 era count as the Owner's confirmation (AUTO_MARK and legacy do not)", heldConfirmedByOwner({ ...base, status_source: "MANUAL" }) && !heldConfirmedByOwner({ ...base, status_source: "AUTO_MARK" }) && !heldConfirmedByOwner({ ...base, status_source: null, date: "2026-09-20" }));
  const { projectLastEventAt } = await import("../lib/partner/projects/memory");
  const src = (statusSource: string | null) => ({ now: new Date("2026-10-02T09:00:00Z"), identities: { cleantone: null }, state: { status: "OK", value: { todayIL: "2026-10-02", domains: { sessions: { data: { items: [{ id: "s", projectId: "p", showId: null, dateYmd: "2026-10-01", status: "התקיים", sessionType: "סשן", statusSource, startTime: "11:00", endTime: "13:00" }] } }, victor: { data: { active: [] } }, releasesFull: { data: { items: [] } } } } }, operations: { status: "OK", value: {} } }) as never;
  ok("project memory: an AUTO_MARK held is NOT a recorded event; a MANUAL one is", projectLastEventAt(src("AUTO_MARK"), "p") === null && projectLastEventAt(src("MANUAL"), "p") === "2026-10-01T00:00:00Z");
  const wv = read("lib/partner/work/view.ts");
  ok("session_view serves statusSource + heldMeaning, and AUTO_MARK reads 'NOT the Owner's confirmation'", wv.includes("statusSource: s.statusSource ?? null") && wv.includes("heldMeaning: held") && wv.includes("AUTO_MARKED_AS_HAPPENED (time passed, not cancelled — NOT the Owner's confirmation)"));
  const rf = read("lib/partner/redfilms/view.ts");
  ok("Red Films: 'shoot happened' (status stale) only on an Owner-confirmed held shoot; an AUTO_MARK held gets its own not-confirmed signal", rf.includes("p.shoot.sessions.some((s) => heldConfirmedByOwner(") && rf.includes("SHOOT_SESSION_HELD_NOT_CONFIRMED"));
  const wd = read("lib/partner/system/work-domains.ts");
  ok("the SESSION_HAPPENED_NOT_PROVEN rule states the new meaning (AUTO_MARK ≠ confirmation; legacy kept)", wd.includes("AUTO_MARK = the end passed and nobody cancelled it — NOT the Owner's confirmation") && wd.includes("AUTO_MARK_RETIRED_AT 2026-09-27"));
  ok("project_view counts heldAutoMarked apart from legacy", read("lib/partner/projects/view.ts").includes("heldAutoMarked:"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
