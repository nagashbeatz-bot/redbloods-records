/**
 * Golden tests for Redbloods Partner — Baseline lifecycle (Phase D.2/D.3).
 *
 * Run with:   npx tsx scripts/test-partner-baseline.ts
 *
 * Uses an IN-MEMORY fake BaselineIO — never touches Supabase, never touches
 * lib/partner/baseline/store.ts. Exercises runPartnerChangeAwareness()
 * (lib/partner/baseline/lifecycle.ts) against real PartnerCompanyState
 * fixtures built through the real computeCoo() + assemblePartnerCompanyState()
 * pipeline, same as scripts/test-partner-changes.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerCompanyState, PartnerEyesRaw } from "../lib/partner/eyes/types";
import { runPartnerChangeAwareness, type BaselineIO } from "../lib/partner/baseline/lifecycle";
import type { StoredPartnerBaseline } from "../lib/partner/baseline/types";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── minimal fixture (kept small — this suite is about baseline lifecycle, not domain coverage; see scripts/test-partner-changes.ts for that) ──

function buildCooRaw(status: string, now: string): CooRawInput {
  return structuredClone<CooRawInput>({
    sources: [{ source: "projects", status: "ok", rowCount: 1 }, { source: "tasks", status: "ok", rowCount: 0 }, { source: "steven", status: "ok", rowCount: 0 }, { source: "victor", status: "ok", rowCount: 0 }, { source: "proposals", status: "ok", rowCount: 0 }, { source: "shows", status: "ok", rowCount: 0 }, { source: "sessions", status: "ok", rowCount: 0 }, { source: "transactions", status: "ok", rowCount: 0 }, { source: "finance_settings", status: "ok", rowCount: 0 }, { source: "releases", status: "ok", rowCount: 0 }, { source: "agent_alerts", status: "ok", rowCount: 0 }],
    projects: [{ id: "p1", name: "פרויקט", artist: "אמן", status, deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: now, isHidden: false }],
    tasks: [], steven: [], victor: { stuckAfterDays: 5, works: [] }, proposals: [], shows: [], sessions: [], transactions: [],
    financeSettings: [], orphanFinanceKeyCount: 0, releases: { labelProjectsTotal: 0, rows: [] }, alerts: [],
  });
}
function buildEyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: [], clients: [], labelArtists: [], artistBalanceEntries: [], clips: [], sessions: [], shows: [],
    proposalsFull: [], releasesFull: [], transactions: [], tasksFull: [],
  });
}
function buildState(status: string, capturedAt: string): PartnerCompanyState {
  const coo = computeCoo(buildCooRaw(status, capturedAt), new Date(capturedAt));
  return assemblePartnerCompanyState(coo, buildEyesRaw());
}
/** Degrades ONE named domain to a read failure (status UNKNOWN, coverage FAILED, data null) — every other domain stays exactly as built. */
function degradeDomain(state: PartnerCompanyState, ...keys: Array<keyof typeof state.domains>): PartnerCompanyState {
  const clone = structuredClone(state);
  for (const key of keys) {
    (clone.domains[key] as { status: string; coverage: string; data: unknown }).status = "UNKNOWN";
    (clone.domains[key] as { status: string; coverage: string; data: unknown }).coverage = "FAILED";
    (clone.domains[key] as { status: string; coverage: string; data: unknown }).data = null;
  }
  return clone;
}
/** A state where every domain reads as UNKNOWN/failed — simulates a total outage. */
function buildFailedState(capturedAt: string): PartnerCompanyState {
  const state = buildState("בעבודה", capturedAt);
  for (const key of Object.keys(state.domains) as Array<keyof typeof state.domains>) {
    (state.domains[key] as { status: string; coverage: string; data: unknown }).status = "UNKNOWN";
    (state.domains[key] as { status: string; coverage: string; data: unknown }).coverage = "FAILED";
    (state.domains[key] as { status: string; coverage: string; data: unknown }).data = null;
  }
  return state;
}

/** In-memory fake — a real settings-table row would behave the same way (one key, replace on save). */
function makeFakeIO(initial: StoredPartnerBaseline | null = null): BaselineIO & { readonly store: StoredPartnerBaseline | null } {
  let stored = initial;
  return {
    load: async () => stored,
    save: async (b) => { stored = b; },
    get store() { return stored; },
  };
}

async function main() {
  console.log("first run: no baseline exists -> stores one, reports FIRST_OBSERVATION, 0 business changes");
  const io = makeFakeIO(null);
  const state = buildState("בעבודה", "2026-09-22T06:00:00Z");
  const r1 = await runPartnerChangeAwareness(state, io);
  check("0 changes on first observation", r1.changes.length, 0);
  ok("baselineLoaded is false", !r1.baselineLoaded);
  ok("baselineAdvanced is true (a baseline WAS created)", r1.baselineAdvanced);
  ok("diagnostics include FIRST_OBSERVATION", r1.diagnostics.some((d) => d.code === "FIRST_OBSERVATION"));
  ok("a baseline is now actually stored in the fake store", io.store !== null);

  console.log("second identical run -> 0 changes, baseline advances again (idempotent, no history growth)");
  const r2 = await runPartnerChangeAwareness(state, io);
  check("0 changes on an unchanged second run", r2.changes.length, 0);
  ok("baselineLoaded is now true", r2.baselineLoaded);
  ok("baselineAdvanced is true again", r2.baselineAdvanced);
  ok("the fake store still holds exactly one record (single key, no history array)", io.store !== null && typeof io.store === "object");

  console.log("changed run -> exactly the expected change, baseline advances");
  const changedState = buildState("הושלם", "2026-09-23T06:00:00Z");
  const r3 = await runPartnerChangeAwareness(changedState, io);
  check("exactly 1 change (project status)", r3.changes.length, 1);
  ok("the change is p1's status", r3.changes[0].domain === "projects" && r3.changes[0].entityId === "p1" && r3.changes[0].field === "status" && r3.changes[0].before === "בעבודה" && r3.changes[0].after === "הושלם");
  ok("baselineAdvanced true — the NEW state (with status=הושלם) is now the baseline", r3.baselineAdvanced);

  console.log("failed current build -> baseline is NOT overwritten (a transient outage must never erase memory)");
  const failedState = buildFailedState("2026-09-24T06:00:00Z");
  const beforeFailureBaseline = JSON.stringify(io.store);
  const r4 = await runPartnerChangeAwareness(failedState, io);
  ok("baselineAdvanced is false", !r4.baselineAdvanced);
  ok("diagnostics include CURRENT_BUILD_INVALID", r4.diagnostics.some((d) => d.code === "CURRENT_BUILD_INVALID"));
  check("the stored baseline is byte-identical to before the failed run (untouched)", JSON.stringify(io.store), beforeFailureBaseline);

  console.log("next good run after a failure -> compares against the LAST GOOD baseline (the failed run left no trace)");
  const recoveredState = buildState("הושלם", "2026-09-25T06:00:00Z"); // same status as r3's baseline — no further status change
  const r5 = await runPartnerChangeAwareness(recoveredState, io);
  ok("0 status changes (comparing against the pre-failure good baseline, which already had status=הושלם)", !r5.changes.some((c) => c.field === "status"));
  ok("baselineAdvanced is true again (a good run resumes advancing the baseline)", r5.baselineAdvanced);

  // ══════════════════════════════════════════════════════════════════════════
  // Partial-failure hardening (found in pre-launch review, before the first
  // production write): baseline advancement must require EVERY domain to read
  // cleanly, not just "at least one" — see assessCurrentBuild()'s own doc
  // comment in lifecycle.ts for the exact scenario this prevents.
  // ══════════════════════════════════════════════════════════════════════════

  console.log("PARTIAL HARDENING 1/6: previous baseline fully healthy, current run has 1 FAILED domain among many healthy ones -> baseline NOT advanced, untouched");
  {
    const ioH = makeFakeIO(null);
    const healthy = buildState("בעבודה", "2026-09-22T06:00:00Z");
    const rGood = await runPartnerChangeAwareness(healthy, ioH);
    ok("initial healthy baseline established", rGood.baselineAdvanced && ioH.store !== null);
    const beforeBaseline = JSON.stringify(ioH.store);

    const oneDomainFailed = degradeDomain(buildState("בעבודה", "2026-09-23T06:00:00Z"), "transactions");
    const rPartial = await runPartnerChangeAwareness(oneDomainFailed, ioH);
    ok("baselineAdvanced is false (a single failed domain blocks the WHOLE baseline)", !rPartial.baselineAdvanced);
    ok("diagnostics include CURRENT_BUILD_INVALID naming the failed domain", rPartial.diagnostics.some((d) => d.code === "CURRENT_BUILD_INVALID" && d.message.includes("transactions")));
    check("the persisted baseline is BYTE-IDENTICAL to before this run (every domain's last-known-good state preserved, not just transactions')", JSON.stringify(ioH.store), beforeBaseline);
  }

  console.log("PARTIAL HARDENING 2/6: an intentionally-PARTIAL-but-successful domain (projects: is_hidden=false scope) does NOT alone block advancement");
  {
    const ioH = makeFakeIO(null);
    const healthy = buildState("בעבודה", "2026-09-22T06:00:00Z");
    ok("sanity: projects domain in this fixture is status=AVAILABLE with coverage=PARTIAL (scope, not failure)", healthy.domains.projects.status === "AVAILABLE" && healthy.domains.projects.coverage === "PARTIAL");
    const r = await runPartnerChangeAwareness(healthy, ioH);
    ok("baselineAdvanced is true despite projects' PARTIAL *coverage* (status is AVAILABLE — that's what matters)", r.baselineAdvanced);
  }

  console.log("PARTIAL HARDENING 3/6: a failed domain later recovers -> the NEXT good run still compares against the ORIGINAL last-known-good baseline, not the failed snapshot");
  {
    const ioH = makeFakeIO(null);
    const day1 = buildState("בעבודה", "2026-09-22T06:00:00Z");
    await runPartnerChangeAwareness(day1, ioH);
    const day1BaselineJson = JSON.stringify(ioH.store);

    const day2Failed = degradeDomain(buildState("בעבודה", "2026-09-23T06:00:00Z"), "sessions");
    const rDay2 = await runPartnerChangeAwareness(day2Failed, ioH);
    ok("day 2 (sessions failed): baseline not advanced", !rDay2.baselineAdvanced);
    check("day 2's failure left the baseline exactly as day 1 saved it", JSON.stringify(ioH.store), day1BaselineJson);

    // day 3: sessions recovers AND a real change happened (project status) during the outage window
    const day3Recovered = buildState("הושלם", "2026-09-24T06:00:00Z");
    const rDay3 = await runPartnerChangeAwareness(day3Recovered, ioH);
    ok("day 3: comparison ran against day 1's baseline (previousCapturedAt is day 1's, NOT day 2's failed attempt)", rDay3.previousCapturedAt === day1.capturedAt);
    ok("day 3: the real change that happened is correctly detected (never lost because of the day-2 outage)", rDay3.changes.some((c) => c.field === "status" && c.before === "בעבודה" && c.after === "הושלם"));
    ok("day 3: baseline advances again now that everything is healthy", rDay3.baselineAdvanced);
  }

  console.log("PARTIAL HARDENING 4/6: MULTIPLE failed domains -> baseline not advanced (same rule, not a special case)");
  {
    const ioH = makeFakeIO(null);
    await runPartnerChangeAwareness(buildState("בעבודה", "2026-09-22T06:00:00Z"), ioH);
    const beforeBaseline = JSON.stringify(ioH.store);
    const multiFailed = degradeDomain(buildState("בעבודה", "2026-09-23T06:00:00Z"), "transactions", "sessions", "victor");
    const r = await runPartnerChangeAwareness(multiFailed, ioH);
    ok("baselineAdvanced is false", !r.baselineAdvanced);
    ok("diagnostic names all 3 failed domains", ["transactions", "sessions", "victor"].every((d) => r.diagnostics.some((diag) => diag.code === "CURRENT_BUILD_INVALID" && diag.message.includes(d))));
    check("baseline untouched", JSON.stringify(ioH.store), beforeBaseline);
  }

  console.log("PARTIAL HARDENING 5/6: all domains healthy again -> baseline advances normally");
  {
    const ioH = makeFakeIO(null);
    await runPartnerChangeAwareness(buildState("בעבודה", "2026-09-22T06:00:00Z"), ioH);
    const allHealthy = buildState("הושלם", "2026-09-23T06:00:00Z");
    const r = await runPartnerChangeAwareness(allHealthy, ioH);
    ok("baselineAdvanced is true", r.baselineAdvanced);
    ok("the real status change was still reported", r.changes.some((c) => c.field === "status"));
  }

  console.log("PARTIAL HARDENING 6/6: UNAVAILABLE (a domain that legitimately has no table, e.g. suppliers) is NEVER treated as a failure");
  {
    const ioH = makeFakeIO(null);
    const st = buildState("בעבודה", "2026-09-22T06:00:00Z");
    ok("sanity: suppliers domain is status=UNAVAILABLE by design in every snapshot (no dedicated table)", st.domains.suppliers.status === "UNAVAILABLE");
    const r = await runPartnerChangeAwareness(st, ioH);
    ok("baselineAdvanced is true — UNAVAILABLE never blocks, only UNKNOWN/PARTIAL (real read failures) do", r.baselineAdvanced);
  }

  console.log("incompatible schema baseline -> handled safely, engine's own INCOMPATIBLE_SCHEMA diagnostic surfaces, baseline still advances (self-heals to the current schema)");
  {
    const ioBad = makeFakeIO({ schemaVersion: "partner-change-snapshot-v0-ANCIENT", snapshot: { schemaVersion: "partner-change-snapshot-v0-ANCIENT" } as never, savedAt: "2020-01-01T00:00:00Z" });
    const st = buildState("בעבודה", "2026-09-22T06:00:00Z");
    const r = await runPartnerChangeAwareness(st, ioBad);
    ok("0 changes reported (never guesses across an incompatible schema)", r.changes.length === 0);
    ok("diagnostics include INCOMPATIBLE_SCHEMA (from the pure engine)", r.diagnostics.some((d) => d.code === "INCOMPATIBLE_SCHEMA"));
    ok("baselineAdvanced is true — self-heals by saving a fresh, current-schema baseline", r.baselineAdvanced);
    ok("the stored baseline now carries the CURRENT schema version, not the ancient one", ioBad.store?.schemaVersion !== "partner-change-snapshot-v0-ANCIENT");
  }

  console.log("baseline load throws (e.g. corrupt row / network error) -> handled safely, never crashes, never saves blindly");
  {
    const ioThrows: BaselineIO = { load: async () => { throw new Error("simulated corrupt/unreadable row"); }, save: async () => {} };
    const st = buildState("בעבודה", "2026-09-22T06:00:00Z");
    const r = await runPartnerChangeAwareness(st, ioThrows);
    ok("0 changes, never crashes", r.changes.length === 0);
    ok("diagnostics include BASELINE_LOAD_FAILED", r.diagnostics.some((d) => d.code === "BASELINE_LOAD_FAILED"));
    ok("baselineAdvanced is false (never blindly saves over an unreadable state)", !r.baselineAdvanced);
  }

  console.log("restart simulation: a fresh process (new fake IO instance) reloads the SAME persisted data and continues correctly");
  {
    const persisted: { value: StoredPartnerBaseline | null } = { value: null };
    const ioProcess1: BaselineIO = { load: async () => persisted.value, save: async (b) => { persisted.value = b; } };
    const st1 = buildState("בעבודה", "2026-09-22T06:00:00Z");
    await runPartnerChangeAwareness(st1, ioProcess1);
    ok("process 1 persisted a baseline", persisted.value !== null);
    const ioProcess2: BaselineIO = { load: async () => persisted.value, save: async (b) => { persisted.value = b; } };
    const st2 = buildState("הושלם", "2026-09-23T06:00:00Z");
    const r = await runPartnerChangeAwareness(st2, ioProcess2);
    ok("process 2 (post-restart) correctly loaded process 1's baseline and detected the real change", r.baselineLoaded && r.changes.some((c) => c.field === "status" && c.after === "הושלם"));
  }

  console.log("static checks: baseline module isolation");
  const ROOT = path.resolve(__dirname, "..");
  const baselineDir = path.join(ROOT, "lib/partner/baseline");
  const files = fs.readdirSync(baselineDir);
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(baselineDir, f), "utf8")]));

  ok("lifecycle.ts does NOT import server-only or Supabase (stays testable with a fake IO)", !/^\s*import\s+"server-only"\s*;/m.test(src["lifecycle.ts"]) && !/lib\/supabase/.test(src["lifecycle.ts"]));
  ok("store.ts and build.ts DO import \"server-only\" (the only two IO-touching files)", /^\s*import\s+"server-only"\s*;/m.test(src["store.ts"]) && /^\s*import\s+"server-only"\s*;/m.test(src["build.ts"]));
  ok("only store.ts imports lib/supabase", Object.entries(src).filter(([f]) => f !== "store.ts").every(([, s]) => !/lib\/supabase/.test(s)));
  ok("only ONE settings key is ever referenced (no accidental second key / history table)", (src["store.ts"].match(/"partner_change_baseline/g) ?? []).length >= 1 && !/partner_change_baseline_2|partner_change_history|partner_snapshots/.test(src["store.ts"]));
  ok("no insert/delete/rpc verb anywhere (only the single upsert by key, matching lib/vendor-store.ts's own settings pattern)", Object.values(src).every((s) => !/\.(insert|delete|rpc)\(/.test(s)));
  ok("no LLM / AI provider anywhere", Object.values(src).every((s) => !/openai|anthropic|groq|gpt-|claude-/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))));
  ok("no Cron / Push / Agent Alerts import anywhere (D.3 has no scheduling yet — Owner instruction §59)", Object.values(src).every((s) => !/node-cron|lib\/push|web-push|agent_alerts|agent\/alerts-store/.test(s)));
  // F.1I: the only /api/partner route is the Owner-only read-only actions surface — and it does not expose baseline.
  ok("no API route added under app/api for baseline (/api/partner holds only the Partner action routes — F.1I surface + F.1J decisions + F.1K execute + F.1M outcomes (GET) + F2 finance (GET) — none imports lib/partner/baseline)", (() => { const dir = path.join(ROOT, "app/api/partner"); if (!fs.existsSync(dir)) return true; const list = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join("/")]); const files = list(dir); const allowed = ["actions/route.ts", "actions/decide/route.ts", "actions/change-deadline/route.ts", "actions/execute/route.ts", "outcomes/route.ts", "finance/route.ts"]; return files.every((x) => allowed.includes(x)) && files.every((x) => !fs.readFileSync(path.join(dir, x), "utf8").includes("lib/partner/baseline")); })());
  ok("no portal file imports lib/partner/baseline", (() => {
    const portalDirs = ["app/api/red-artists", "app/api/supplier", "app/api/vendor/victor", "app/api/label/artists", "app/api/beats", "app/api/notifications", "components/team", "components/red-artists", "components/label", "lib/red-artists", "app/team", "app/red-artists", "app/dj-cleantone", "app/label"];
    const walk = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
    const portalFiles = [...portalDirs.flatMap((d) => walk(path.join(ROOT, d))), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /^(steven|victor|shalev|avi|cleantone|dj-|beat|show-|sketch)/.test(f)).map((f) => path.join(ROOT, "lib", f))];
    return portalFiles.every((f) => !/lib\/partner\/baseline/.test(fs.readFileSync(f, "utf8")));
  })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("test run failed:", e); process.exit(1); });
